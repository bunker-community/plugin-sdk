/*
 * Uzak plugin istemcisi: plugin'i kendi bilgisayarinda / sunucunda calistirip Bunker'a gecitten baglar.
 *
 *   import { connect, definePlugin } from "@bunker-community/plugin-sdk";
 *   const plugin = definePlugin({ setup(ctx) { ctx.command("selam", (c) => c.reply("Selam!")); } });
 *   connect(plugin, { token: process.env.BUNKER_TOKEN! });
 *
 * Plugin kodu yerel plugin'lerle AYNI (PluginContext). Fark: ses kanalina ham PCM gonderilemez (playPcm yok).
 * Baglanti koparsa kendiliginden yeniden baglanir; dinleyiciler ve komutlar yeniden kaydedilir.
 * Kapi protokolu (JSON, WebSocket):
 *   istemci -> { op: "hello", token, sdk, manifest?, uiPage? } | { op: "call", id, method, args }
 *   sunucu  -> { op: "ready", manifest, guilds } | { op: "result", id, ok, value | error }
 *            | { op: "event", name, data } | { op: "command", name, call } | { op: "voice", cid, ev, args, state }
 */
import type {
  CommandCall, MediaMeta, PluginContext, PluginDefinition, PluginEventName, PluginEvents, PluginManifest, UiAction, VoiceSession,
} from "./types.ts";
import { SDK_VERSION as SDK } from "./version.ts";
export const DEFAULT_GATEWAY = "wss://bunker.community/app/api/plugin/gateway";

export interface ConnectOptions {
  /** Ayarlar -> Geliştirici'den alinan anahtar */
  token: string;
  /** Gecit adresi (varsayilan bunker.community) */
  url?: string;
  /**
   * Manifest (bunker-plugin.json icerigi). Verilmezse `dir` klasorundeki bunker-plugin.json okunur; o da yoksa
   * Bunker'da kayitli manifest kullanilir. id alani yok sayilir (anahtarin plugin'i).
   */
  manifest?: Partial<PluginManifest>;
  /** bunker-plugin.json ve pencere sayfasinin klasoru (varsayilan: calisma klasoru) */
  dir?: string;
  /** Pencere sayfasinin HTML'i (verilmezse manifest ui.page dosyasi `dir`'den okunur) */
  uiPage?: string;
  /**
   * Baglanti (varsayilan: WebSocket(url)). Bunker'da barindirilan plugin'lerde calisma ortami kendi kanalini
   * verir; normalde verme.
   */
  transport?: (url: string) => TransportLike;
  /** Kayit (varsayilan console) */
  logger?: { info(...a: unknown[]): void; warn(...a: unknown[]): void; error(...a: unknown[]): void };
}

/** WebSocket'in kullanilan kismi */
export interface TransportLike {
  onopen: ((e?: unknown) => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e: { code: number; reason: string }) => void) | null;
  onerror: ((e?: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Connection {
  /** Ilk baglanti kuruldu ve setup calisti */
  readonly ready: Promise<void>;
  readonly connected: boolean;
  /** Baglantiyi kapat, onUnload'lari calistir */
  close(): Promise<void>;
}

/** Bu kodlarla kapanirsa yeniden denenmez */
const FATAL: Record<number, string> = {
  4001: "anahtar geçersiz",
  4003: "plugin Bunker'da kapalı",
  4004: "aynı anahtarla başka bir bağlantı açıldı",
  4005: "manifest geçersiz",
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
  const commands = new Map<string, (c: CommandCall) => unknown>();
  const unloaders: (() => unknown)[] = [];
  const sessions = new Map<string, RemoteSession>();
  let readyResolve!: () => void, readyReject!: (e: Error) => void;
  const ready = new Promise<void>((res, rej) => { readyResolve = res; readyReject = rej; });
  ready.catch(() => {});

  const raw = (m: unknown) => { if (ws && open) ws.send(JSON.stringify(m)); };
  function call<T = unknown>(method: string, ...args: unknown[]): Promise<T> {
    if (!ws || !open) return Promise.reject(new Error("Bunker'a bağlı değil"));
    const id = ++seq;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      raw({ op: "call", id, method, args });
    });
  }
  /** Sonucu beklenmeyen cagri (hata kayda) */
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
        log.warn("[bunker] manifest/pencere okunamadı:", (e as Error).message);
      }
    }
    return { m, page };
  }

  function resubscribe() {
    for (const name of events.keys()) fire("subscribe", name);
    for (const name of commands.keys()) fire("command", name);
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
    command(name: string, fn: (c: CommandCall) => unknown) {
      const n = String(name).replace(/^!/, "").toLocaleLowerCase("tr");
      if (commands.has(n)) throw new Error(`!${n} zaten kayıtlı`);
      commands.set(n, fn);
      if (open) fire("command", n);
      return () => { commands.delete(n); if (open) fire("uncommand", n); };
    },
    chat: { send: (chan, text) => call("chat.send", chan, text) },
    storage: {
      get: <T>(key: string) => call<T | undefined>("storage.get", key).then((v) => (v === null ? undefined : v)),
      set: (key, value) => call("storage.set", key, value).then(() => {}),
      delete: (key) => call("storage.delete", key).then(() => {}),
      keys: (prefix = "") => call<string[]>("storage.keys", prefix),
    },
    voice: {
      async join(cid: string) { return sessionFor(await call<SessionState>("voice.join", cid)); },
      session(cid: string) { return sessions.get(cid) ?? null; },
    },
    ui: {
      setState: (where, state, o) => fire("ui.setState", where, state, o ?? {}),
      onAction(fn: (a: UiAction) => unknown) {
        return ctx.on("ui.action" as PluginEventName, fn as never);
      },
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
        log.info(`[bunker] bağlandı: ${manifest!.name} (${manifest!.id}), ${m.guilds?.length ?? 0} sunucu`);
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
        const fn = commands.get(m.name);
        const c = m.call;
        if (fn) safe("!" + m.name, () => fn({ ...c, reply: async (text: string) => { await call("chat.send", c.chan, text); } }));
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
      for (const p of pending.values()) p.reject(new Error("bağlantı koptu"));
      pending.clear();
      for (const s of sessions.values()) { s.st = { ...s.st, connected: false, playing: false }; s.emit("leave", ["bağlantı koptu"], safe); }
      sessions.clear();
      if (closed) return;
      const fatal = FATAL[e.code];
      if (fatal) {
        log.error(`[bunker] bağlantı kapandı: ${fatal}${e.reason ? ` (${e.reason})` : ""}`);
        closed = true;
        readyReject(new Error(e.reason || fatal));
        return;
      }
      log.warn(`[bunker] bağlantı koptu (${e.code}${e.reason ? " " + e.reason : ""}), ${Math.round(backoff / 1000)} sn sonra yeniden`);
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
      ws?.close(1000, "kapatıldı");
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
  playPcm(): void { throw new Error("playPcm uzak plugin'lerde yok (playUrl / playMedia kullan)"); }
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
