/*
 * Remote plugin client: runs the plugin on your own computer / server and connects it to Bunker through the gateway.
 *
 *   import { connect, definePlugin } from "@bunker-community/plugin-sdk";
 *   const plugin = definePlugin({ setup(ctx) { ctx.command("hi", (c) => c.reply("Hi!")); } });
 *   connect(plugin, { token: process.env.BUNKER_TOKEN! });
 *
 * The plugin code is the SAME as for local plugins (PluginContext). Difference: raw PCM can't be sent to a voice channel (no playPcm).
 * If the connection drops it reconnects on its own; listeners and commands are registered again.
 * Gateway protocol (JSON, WebSocket):
 *   client -> { op: "hello", token, sdk, manifest?, uiPage? } | { op: "call", id, method, args }
 *   server -> { op: "ready", manifest, guilds } | { op: "result", id, ok, value | error }
 *            | { op: "event", name, data } | { op: "command", name, call } | { op: "voice", cid, ev, args, state }
 */
import type {
  ButtonClick, CommandCall, CommandOptions, GuildChannel, GuildInfo, GuildMember, GuildRole, HttpRequest, HttpResponse, MediaMeta, MessageButton,
  PluginContext, PluginDefinition, PluginEventName, PluginEvents, PluginManifest, ReplyOptions, SendOptions, UiAction, VoiceMember, VoiceSession,
  WebhookInfo, WebhookRequest,
} from "./types.ts";
import { SDK_VERSION as SDK } from "./version.ts";
export const DEFAULT_GATEWAY = "wss://bunker.community/app/api/plugin/gateway";

export interface ConnectOptions {
  /** The token from Settings -> Developer */
  token: string;
  /** Gateway address (default bunker.community) */
  url?: string;
  /**
   * Manifest (the content of bunker-plugin.json). If not given, bunker-plugin.json in the `dir` folder is read; if that is missing too
   * the manifest stored on Bunker is used. The id field is ignored (it is the key's plugin).
   */
  manifest?: Partial<PluginManifest>;
  /** Folder of bunker-plugin.json and the window page (default: the working directory) */
  dir?: string;
  /** HTML of the window page (if not given, the manifest's ui.page file is read from `dir`) */
  uiPage?: string;
  /**
   * Connection (default: WebSocket(url)). For plugins hosted on Bunker the runtime provides its own channel;
   * don't pass it normally.
   */
  transport?: (url: string) => TransportLike;
  /** Logger (default console) */
  logger?: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };
}

/** The part of WebSocket that is used */
export interface TransportLike {
  onopen: ((e?: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: ((e?: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Connection {
  /** The first connection was made and setup ran */
  readonly ready: Promise<void>;
  readonly connected: boolean;
  /** Close the connection, run the onUnload handlers */
  close(): Promise<void>;
}

/** No retry if it closes with these codes */
const FATAL: Record<number, string> = {
  4001: "invalid key",
  4003: "plugin is off on Bunker",
  4004: "another connection was opened with the same key",
  4005: "invalid manifest",
};

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type SessionState = { gid: string; cid: string; playing: boolean; paused: boolean; volume: number; connected: boolean };

export function connect(def: PluginDefinition, opts: ConnectOptions): Connection {
  const log = opts.logger ?? console;
  const url = opts.url ?? DEFAULT_GATEWAY;
  let ws: TransportLike | null = null;
  let open = false;
  let closed = false;
  let started = false;
  let seq = 0;
  let backoff = 1000;
  let manifest: PluginManifest | null = null;
  const pending = new Map<number, Pending>();
  const events = new Map<string, Set<(p: unknown) => unknown>>();
  const commands = new Map<string, { fn: (c: CommandCall) => unknown; opts: CommandOptions }>();
  const unloaders: (() => unknown)[] = [];
  const sessions = new Map<string, RemoteSession>();
  let readyResolve!: () => void, readyReject!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => { readyResolve = res; readyReject = rej; });
  ready.catch(() => {});

  const raw = (m: unknown) => { if (ws && open) ws.send(JSON.stringify(m)); };
  function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (!ws || !open) return Promise.reject(new Error("not connected to Bunker"));
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      raw({ op: "call", id, method, args });
    });
  }
  /** A call whose result wasn't awaited (error to the log) */
  const fire = (method: string, ...args: unknown[]) => { call(method, ...args).catch((e: Error) => log.warn(`[bunker] ${method}: ${e.message}`)); };
  const safe = (where: string, fn: () => unknown) => {
    try { const r = fn(); if (r && typeof (r as Promise<unknown>).then === "function") (r as Promise<unknown>).catch((e) => log.error(`[bunker] ${where}:`, e)); }
    catch (e) { log.error(`[bunker] ${where}:`, e); }
  };

  async function loadLocal() {
    let m = opts.manifest as Record<string, unknown> | undefined;
    let page = opts.uiPage;
    if (!m || (m.ui && page === undefined)) {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const dir = opts.dir ?? process.cwd();
        if (!m) { const f = path.join(dir, "bunker-plugin.json"); if (fs.existsSync(f)) m = JSON.parse(fs.readFileSync(f, "utf8")); }
        const ui = m?.ui as { page?: string } | undefined;
        if (ui?.page && page === undefined) page = fs.readFileSync(path.join(dir, ui.page), "utf8");
      } catch (e) {
        log.warn("[bunker] could not read manifest/window:", (e as Error).message);
      }
    }
    return { m, page };
  }

  function resubscribe() {
    for (const name of events.keys()) fire("subscribe", name);
    for (const [name, c] of commands) fire("command", name, c.opts);
  }

  const ctx: PluginContext = {
    get manifest() { return manifest!; },
    log: {
      info: (msg, c) => fire("log", "info", String(msg), c),
      warn: (msg, c) => fire("log", "warn", String(msg), c),
      error: (msg, c) => fire("log", "error", String(msg), c),
    },
    on<K extends PluginEventName>(name: K, fn: (payload: PluginEvents[K]) => unknown) {
      let set = events.get(name);
      if (!set) { set = new Set(); events.set(name, set); if (open) fire("subscribe", name); }
      const f = fn as (p: unknown) => unknown;
      set.add(f);
      return () => { set!.delete(f); if (!set!.size) { events.delete(name); if (open) fire("unsubscribe", name); } };
    },
    command(name: string, fn: (c: CommandCall) => unknown, opts?: CommandOptions) {
      const n = String(name).replace(/^!/, "").toLocaleLowerCase("tr");
      if (commands.has(n)) throw new Error(`!${n} is already registered`);
      commands.set(n, { fn, opts: opts ?? {} });
      if (open) fire("command", n, opts ?? {});
      return () => { commands.delete(n); if (open) fire("uncommand", n); };
    },
    chat: {
      send: (chan: string, text: string, opts?: SendOptions) => call("chat.send", chan, text, opts ?? {}),
      // A click arrives with a token; reply / update go back through it
      onButton(fn: (b: ButtonClick) => unknown) {
        return ctx.on("chat.button" as PluginEventName, ((d: Omit<ButtonClick, "reply" | "update"> & { token: string }) => {
          const { token, ...rest } = d;
          return fn({
            ...rest,
            reply: (text: string, o?: ReplyOptions) => call("interaction.reply", token, text, o ?? {}).then(() => {}),
            update: (u: { text?: string; buttons?: MessageButton[] }) => call("interaction.update", token, u ?? {}).then(() => {}),
          });
        }) as never);
      },
    },
    guild: {
      info: (gid: string) => call<GuildInfo | null>("guild.info", gid),
      channels: (gid: string) => call<GuildChannel[]>("guild.channels", gid),
      roles: (gid: string) => call<GuildRole[]>("guild.roles", gid),
      members: (gid: string) => call<GuildMember[]>("guild.members", gid),
      member: (gid: string, uid: string) => call<GuildMember | null>("guild.member", gid, uid),
    },
    http: {
      async fetch(url: string, req?: HttpRequest): Promise<HttpResponse> {
        const r = await call<{ status: number; headers: Record<string, string>; body: string }>("http.fetch", url, req ?? {});
        return { ...r, ok: r.status >= 200 && r.status < 300, json: <T>() => JSON.parse(r.body) as T };
      },
    },
    webhooks: {
      create: (gid: string, name: string) => call<WebhookInfo & { url: string }>("webhooks.create", gid, name),
      list: (gid: string) => call<WebhookInfo[]>("webhooks.list", gid),
      delete: (id: string) => call("webhooks.delete", id).then(() => {}),
      onRequest(fn: (r: WebhookRequest) => unknown) { return ctx.on("webhook.request" as PluginEventName, fn as never); },
    },
    settings: {
      get: (gid: string) => call<Record<string, unknown>>("settings.get", gid).then((v) => v ?? {}),
    },
    storage: {
      get: <T>(key: string) => call<T | undefined>("storage.get", key).then((v) => (v === null ? undefined : v)),
      set: (key, value) => call("storage.set", key, value).then(() => {}),
      delete: (key) => call("storage.delete", key).then(() => {}),
      keys: (prefix = "") => call<string[]>("storage.keys", prefix),
    },
    serverLang: (gid: string) => call<"en" | "tr">("serverLang", gid).then((v) => (v === "tr" ? "tr" : "en")),
    voice: {
      async join(cid: string) { return sessionFor(await call<SessionState>("voice.join", cid)); },
      session(cid: string) { return sessions.get(cid) ?? null; },
      channelOf: (uid: string) => call<{ gid: string; cid: string } | null>("voice.channelOf", uid),
      members: (cid: string) => call<VoiceMember[]>("voice.members", cid).then((v) => (Array.isArray(v) ? v : [])),
    },
    ui: {
      setState: (where, state, o) => fire("ui.setState", where, state, o ?? {}),
      onAction(fn: (a: UiAction) => unknown) {
        return ctx.on("ui.action" as PluginEventName, fn as never);
      },
      send: (uid, where, data) => fire("ui.send", uid, where, data),
    },
    onUnload(fn) { unloaders.push(fn); },
  };

  function sessionFor(st: SessionState) {
    let s = sessions.get(st.cid);
    if (!s) { s = new RemoteSession(st, call); sessions.set(st.cid, s); }
    s.st = st;
    return s;
  }

  function onMessage(data: string) {
    let m: Record<string, any>;
    try { m = JSON.parse(data); } catch { return; }
    switch (m.op) {
      case "ready":
        manifest = m.manifest;
        backoff = 1000;
        log.info(`[bunker] connected: ${manifest!.name} (${manifest!.id}), ${m.guilds?.length ?? 0} servers`);
        if (!started) {
          started = true;
          Promise.resolve().then(() => def.setup(ctx)).then(() => readyResolve(), (e) => { log.error("[bunker] setup:", e); readyReject(e); });
        } else resubscribe();
        return;
      case "result": {
        const p = pending.get(m.id);
        if (!p) return;
        pending.delete(m.id);
        if (m.ok) p.resolve(m.value ?? undefined);
        else p.reject(new Error(String(m.error)));
        return;
      }
      case "event":
        for (const fn of [...(events.get(m.name) ?? [])]) safe(m.name, () => fn(m.data));
        return;
      case "command": {
        const fn = commands.get(m.name)?.fn;
        const { token, ...c } = m.call;
        if (fn) safe("!" + m.name, () => fn({ ...c, lang: c.lang === "tr" ? "tr" : "en", reply: async (text: string, o?: ReplyOptions) => { await call("interaction.reply", token, text, o ?? {}); } }));
        return;
      }
      case "voice": {
        const s = sessions.get(m.cid);
        if (!s) return;
        s.st = m.state;
        if (m.ev === "leave") sessions.delete(m.cid);
        s.emit(m.ev, m.args ?? [], safe);
        return;
      }
    }
  }

  async function dial() {
    if (closed) return;
    const { m, page } = await loadLocal();
    const sock: TransportLike = opts.transport ? opts.transport(url) : (new WebSocket(url) as unknown as TransportLike);
    ws = sock;
    sock.onopen = () => {
      open = true;
      sock.send(JSON.stringify({ op: "hello", token: opts.token, sdk: SDK, ...(m ? { manifest: m } : {}), ...(page !== undefined ? { uiPage: page } : {}) }));
    };
    sock.onmessage = (e) => onMessage(String(e.data));
    sock.onclose = (e) => {
      open = false;
      ws = null;
      for (const p of pending.values()) p.reject(new Error("connection lost"));
      pending.clear();
      for (const s of sessions.values()) { s.st = { ...s.st, connected: false, playing: false }; s.emit("leave", ["connection lost"], safe); }
      sessions.clear();
      if (closed) return;
      const fatal = FATAL[e.code];
      if (fatal) {
        log.error(`[bunker] connection closed: ${fatal}${e.reason ? ` (${e.reason})` : ""}`);
        closed = true;
        readyReject(new Error(e.reason || fatal));
        return;
      }
      log.warn(`[bunker] connection lost (${e.code}${e.reason ? " " + e.reason : ""}), retrying in ${Math.round(backoff / 1000)} s`);
      setTimeout(() => void dial(), backoff);
      backoff = Math.min(30_000, backoff * 2);
    };
    sock.onerror = () => {};
  }
  void dial();

  return {
    ready,
    get connected() { return open; },
    async close() {
      if (closed && !ws) return;
      closed = true;
      for (const u of unloaders.splice(0)) { try { await u(); } catch (e) { log.error("[bunker] onUnload:", e); } }
      ws?.close(1000, "turned off");
    },
  };
}

class RemoteSession implements VoiceSession {
  st: SessionState;
  private readonly call: <T>(method: string, ...args: unknown[]) => Promise<T>;
  private readonly fns = new Map<string, Set<(...a: any[]) => unknown>>();
  constructor(st: SessionState, call: <T>(method: string, ...args: unknown[]) => Promise<T>) { this.st = st; this.call = call; }
  get gid() { return this.st.gid; }
  get cid() { return this.st.cid; }
  get playing() { return this.st.playing; }
  get paused() { return this.st.paused; }
  get volume() { return this.st.volume; }
  get connected() { return this.st.connected; }
  private do(method: string, ...args: unknown[]) { return this.call<SessionState>("voice.call", this.st.cid, method, args).then((st) => { if (st) this.st = st; }); }
  private quiet(method: string, ...args: unknown[]) { this.do(method, ...args).catch(() => {}); }
  playPcm(): void { throw new Error("playPcm is not available for remote plugins (use playUrl / playMedia)"); }
  playUrl(url: string, opts?: { seek?: number }) { return this.do("playUrl", url, opts ?? {}); }
  playMedia(query: string, opts?: { seek?: number }) { return this.do("playMedia", query, opts ?? {}); }
  prefetch(query: string) { this.quiet("prefetch", query); }
  stop() { this.quiet("stop"); }
  pause() { this.st = { ...this.st, paused: true }; this.quiet("pause"); }
  resume() { this.st = { ...this.st, paused: false }; this.quiet("resume"); }
  setVolume(v: number) { this.st = { ...this.st, volume: v }; this.quiet("setVolume", v); }
  leave() { return this.do("leave"); }
  on(ev: "started" | "ended", fn: () => unknown): () => void;
  on(ev: "error", fn: (why: string, info: { silent: boolean }) => unknown): () => void;
  on(ev: "leave", fn: (why: string) => unknown): () => void;
  on(ev: "meta", fn: (m: MediaMeta) => unknown): () => void;
  on(ev: string, fn: (...a: any[]) => unknown) {
    let set = this.fns.get(ev);
    if (!set) { set = new Set(); this.fns.set(ev, set); }
    set.add(fn);
    return () => void set!.delete(fn);
  }
  emit(ev: string, args: unknown[], safe: (where: string, fn: () => unknown) => void) {
    for (const fn of [...(this.fns.get(ev) ?? [])]) safe("voice." + ev, () => fn(...args));
  }
}
