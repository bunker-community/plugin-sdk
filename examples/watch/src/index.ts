/*
 * Watch Together (plugin). Replaced the core watch together on 2026-11-23.
 *
 * Synced video in a voice channel: YouTube, Twitch (past broadcast / live channel), Vimeo, a direct video link
 * (.mp4/.webm/.m3u8...), a file on everyone's own computer (only its name + size are shared; everyone picks their copy).
 * The plugin only keeps "which video, which second, is it playing" per channel; every viewer's page runs its own
 * player and follows the state (ui/index.html). No network requests here: titles come from the viewers' players.
 *
 * Window state (per channel, null = nothing is watched):
 *   { src, vid, title, byNick, live, size, playing, pos, dur, queue: [{src, vid, title, byNick, live, size}], seq, ev }
 *   pos = the position when the state was produced (the page adds ctx.age while playing); seq grows on every change;
 *   ev = the last change { n, kind: start|change|add|stop|next, nick, title } (the page shows it as a short notice).
 * Actions: start {url | file:{name,size}}, add {...}, ctl {op: play|pause|seek, pos}, dur {vid, dur}, title {vid, title},
 *   end {vid}, next, jump {index}, remove {index}, stop.
 * Errors go only to the person (ctx.ui.send: { error: key }); the page translates the key.
 * Sessions end when no humans are left in the channel; they survive a restart (storage "sessions").
 */
import { definePlugin, type PluginContext, type UiAction } from "@bunker-community/plugin-sdk";

type Source = "yt" | "twitch" | "vimeo" | "url" | "file";
interface Item { src: Source; vid: string; title: string; byNick: string; live?: boolean; size?: number }
interface Session extends Item {
  gid: string;
  cid: string;
  playing: boolean;
  /** seconds, position at time `at` */
  pos: number;
  /** ms */
  at: number;
  /** seconds, reported by a viewer (0 = unknown) */
  dur: number;
  queue: Item[];
  seq: number;
  /** was the title reported by a viewer (or known from the link) */
  titled: boolean;
  ev: { n: number; kind: "start" | "change" | "add" | "stop" | "next"; nick: string; title: string } | null;
}
type Parsed = { src: Source; vid: string; start: number; live?: boolean; title?: string };

const MAX_QUEUE = 50;
const YT_RE = /^[A-Za-z0-9_-]{11}$/;
const MEDIA_EXT = /\.(mp4|m4v|webm|mov|mkv|ogv|ogg|m3u8)$/i;
const TWITCH_RESERVED = new Set(["videos", "directory", "settings", "p", "search", "downloads", "jobs", "turbo", "subscriptions", "inventory", "wallet", "drops", "friends", "messages", "store", "prime", "popout", "moderator", "embed"]);

/** An error the page shows to the person (the key is translated there) */
class UserError extends Error {}

/** "1h2m3s" / "90" / "1m30s" -> seconds */
function hms(t: string) {
  const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!m || !t) return 0;
  return Math.min(Number(m[1] ?? 0) * 3600 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0), 86400 * 2);
}
const clean = (v: unknown, max: number) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);

/** Source + id + start second from a link. null if not supported. */
function parseSource(input: unknown): Parsed | null {
  const s = String(input ?? "").trim();
  if (s.length > 1500) return null;
  if (YT_RE.test(s)) return { src: "yt", vid: s, start: 0 };
  let u: URL;
  try { u = new URL(/^https?:\/\//i.test(s) ? s : "https://" + s); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, "");
  const parts = u.pathname.split("/").filter(Boolean);
  const t = u.searchParams.get("t") ?? u.searchParams.get("start") ?? "";

  if (host === "youtu.be" || host === "youtube.com" || host === "youtube-nocookie.com") {
    let vid = "";
    if (host === "youtu.be") vid = parts[0] ?? "";
    else if (u.pathname === "/watch") vid = u.searchParams.get("v") ?? "";
    else if (["embed", "shorts", "live", "v"].includes(parts[0])) vid = parts[1] ?? "";
    return YT_RE.test(vid) ? { src: "yt", vid, start: hms(t) } : null;
  }
  if (host === "twitch.tv" || host === "player.twitch.tv" || host === "clips.twitch.tv") {
    if (host === "clips.twitch.tv" || parts[1] === "clip") throw new UserError("clip");
    if (host === "player.twitch.tv") {
      const v = u.searchParams.get("video"), c = u.searchParams.get("channel");
      if (v && /^v?\d{5,12}$/.test(v)) return { src: "twitch", vid: "v" + v.replace(/^v/, ""), start: hms(u.searchParams.get("time") ?? "") };
      if (c && /^\w{3,25}$/.test(c)) return { src: "twitch", vid: "c:" + c.toLowerCase(), start: 0, live: true, title: c.toLowerCase() };
      return null;
    }
    if (parts[0] === "videos" && /^\d{5,12}$/.test(parts[1] ?? "")) return { src: "twitch", vid: "v" + parts[1], start: hms(t) };
    if (parts.length === 1 && /^\w{3,25}$/.test(parts[0]) && !TWITCH_RESERVED.has(parts[0].toLowerCase())) return { src: "twitch", vid: "c:" + parts[0].toLowerCase(), start: 0, live: true, title: parts[0].toLowerCase() };
    return null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    // vimeo.com/123, vimeo.com/123/hash (unlisted), vimeo.com/channels/x/123, player.vimeo.com/video/123?h=hash
    const i = parts.findIndex((p) => /^\d{5,12}$/.test(p));
    if (i < 0) return null;
    const hash = u.searchParams.get("h") ?? (/^[0-9a-f]{6,20}$/i.test(parts[i + 1] ?? "") ? parts[i + 1] : "");
    return { src: "vimeo", vid: parts[i] + (hash ? ":" + hash : ""), start: hms((u.hash.match(/t=([\dhms]+)/) ?? [])[1] ?? "") };
  }
  if (MEDIA_EXT.test(u.pathname)) {
    let name = u.pathname.split("/").pop() ?? "";
    try { name = decodeURIComponent(name); } catch {}
    return { src: "url", vid: u.href, start: 0, title: clean(name || u.hostname, 200) };
  }
  return null;
}

/** Everyone's own file: name + size (for the match check) */
function fileItem(f: unknown, byNick: string): Item {
  const o = (f ?? {}) as { name?: unknown; size?: unknown };
  const name = clean(o.name, 200);
  const size = Number(o.size);
  if (!name || !Number.isSafeInteger(size) || size <= 0) throw new UserError("file");
  return { src: "file", vid: `${size}:${name}`, title: name, byNick, size };
}

/** Text next to the voice channel in the channel list (brand names, no translation needed) */
function labelOf(s: Item) {
  if (s.title) return s.title;
  return { yt: "YouTube", twitch: "Twitch", vimeo: "Vimeo", url: "Video", file: "Video" }[s.src];
}

export default definePlugin({
  setup(ctx: PluginContext) {
    const sessions = new Map<string, Session>();
    let evN = 0;

    const posOf = (s: Session, now = Date.now()) => {
      const p = s.playing ? s.pos + (now - s.at) / 1000 : s.pos;
      return s.dur > 0 ? Math.min(p, s.dur) : p;
    };
    const itemOf = (s: Item): Item => ({ src: s.src, vid: s.vid, title: s.title, byNick: s.byNick, ...(s.live ? { live: true } : {}), ...(s.size ? { size: s.size } : {}) });
    const view = (s: Session) => ({
      ...itemOf(s), live: Boolean(s.live), playing: s.playing, pos: Math.round(posOf(s) * 1000) / 1000, dur: s.dur,
      queue: s.queue.map(itemOf), seq: s.seq, ev: s.ev,
    });

    function push(s: Session, open = false) {
      if (sessions.get(s.cid) !== s) return;
      ctx.ui.setState({ gid: s.gid, cid: s.cid }, view(s), { live: true, label: labelOf(s), open });
    }
    function end(cid: string) {
      const s = sessions.get(cid);
      if (!s) return;
      sessions.delete(cid);
      try { ctx.ui.setState({ gid: s.gid, cid }, null); } catch {} // the server may be gone already
    }
    const note = (s: Session, kind: NonNullable<Session["ev"]>["kind"], nick: string, title: string) => { s.ev = { n: ++evN, kind, nick, title }; };

    /** New video: opens a session if none, otherwise switches right away */
    function start(gid: string, cid: string, item: Item, startAt: number, titled: boolean) {
      const old = sessions.get(cid);
      const s: Session = { ...item, gid, cid, playing: true, pos: startAt, at: Date.now(), dur: 0, queue: old?.queue ?? [], seq: (old?.seq ?? 0) + 1, titled, ev: old?.ev ?? null };
      sessions.set(cid, s);
      return { s, fresh: !old };
    }
    function next(s: Session) {
      const n = s.queue.shift();
      if (!n) return false;
      start(s.gid, s.cid, n, 0, Boolean(n.title));
      return true;
    }
    function control(s: Session, op: string, pos?: number) {
      const now = Date.now();
      const p = Number.isFinite(pos) ? Math.max(0, Number(pos)) : posOf(s, now);
      if (op === "play") { s.pos = s.dur > 0 && p >= s.dur - 0.5 ? 0 : p; s.playing = true; }
      else if (op === "pause") { s.pos = p; s.playing = false; }
      else if (op === "seek") s.pos = s.dur > 0 ? Math.min(p, s.dur) : p;
      else return;
      s.at = now;
      s.seq++;
    }

    function itemFrom(a: UiAction): { item: Item; start: number; titled: boolean } {
      const d = (a.data ?? {}) as { url?: unknown; file?: unknown };
      if (d.file) { const item = fileItem(d.file, a.nick); return { item, start: 0, titled: true }; }
      const p = parseSource(d.url);
      if (!p) throw new UserError("link");
      return { item: { src: p.src, vid: p.vid, title: p.title ?? "", byNick: a.nick, ...(p.live ? { live: true } : {}) }, start: p.start, titled: Boolean(p.title) };
    }

    ctx.ui.onAction(async (a) => {
      const cid = a.cid!;
      const d = (a.data ?? {}) as Record<string, unknown>;
      try {
        let s = sessions.get(cid);
        if (a.name === "start" || a.name === "add") {
          const { item, start: at, titled } = itemFrom(a);
          if (a.name === "start" || !s) {
            const r = start(a.gid, cid, item, at, titled);
            note(r.s, r.fresh ? "start" : "change", a.nick, item.title);
            ctx.log.info(`${r.fresh ? "started" : "changed"} by ${a.nick}`, { gid: a.gid, cid, src: item.src });
            return push(r.s, r.fresh);
          }
          if (s.queue.length >= MAX_QUEUE) throw new UserError("full");
          s.queue.push(item);
          s.seq++;
          note(s, "add", a.nick, item.title);
          return push(s);
        }
        if (!s) {
          if (["ctl", "next", "jump", "remove", "stop"].includes(a.name)) throw new UserError("none");
          return;
        }
        switch (a.name) {
          case "ctl": control(s, String(d.op ?? ""), d.pos === undefined ? undefined : Number(d.pos)); break;
          case "dur": {
            const dur = Number(d.dur);
            if (d.vid !== s.vid || s.live || s.dur > 0 || !(dur > 0) || dur > 86400 * 3) return;
            s.dur = dur;
            break;
          }
          case "title": {
            const title = clean(d.title, 200);
            if (d.vid !== s.vid || s.titled || !title) return;
            s.title = title;
            s.titled = true;
            if (s.ev && !s.ev.title && (s.ev.kind === "start" || s.ev.kind === "change")) s.ev.title = title;
            s.seq++;
            break;
          }
          case "end": {
            // An early "ended" (someone seeked ahead) doesn't count: our own estimate must be near the end too
            if (d.vid !== s.vid || s.live || (s.dur > 0 && posOf(s) < s.dur - 5)) return;
            if (next(s)) { s = sessions.get(cid)!; break; }
            if (!s.playing) return;
            control(s, "pause", s.dur || undefined);
            break;
          }
          case "next": {
            if (!next(s)) throw new UserError("empty");
            s = sessions.get(cid)!;
            note(s, "next", a.nick, s.title);
            break;
          }
          case "jump": {
            const i = Number(d.index);
            if (!(i >= 0 && i < s.queue.length)) return;
            const [it] = s.queue.splice(i, 1);
            s.queue.unshift(it);
            next(s);
            s = sessions.get(cid)!;
            note(s, "change", a.nick, s.title);
            break;
          }
          case "remove": {
            const i = Number(d.index);
            if (!(i >= 0 && i < s.queue.length)) return;
            s.queue.splice(i, 1);
            s.seq++;
            break;
          }
          case "stop":
            ctx.log.info(`stopped by ${a.nick}`, { gid: a.gid, cid });
            return end(cid);
          default: return;
        }
        push(s);
      } catch (e) {
        if (e instanceof UserError) return ctx.ui.send(a.uid, { gid: a.gid, cid }, { error: e.message });
        throw e;
      }
    });

    // ---- the session ends when no humans are left in the channel
    async function checkEmpty(cid: string) {
      if (!sessions.has(cid)) return;
      const ms = await ctx.voice.members(cid);
      if (!ms.some((m) => !m.bot)) end(cid);
    }
    ctx.on("voice.leave", (e) => { if (!e.bot) return checkEmpty(e.cid); });
    ctx.on("voice.move", (e) => { if (!e.bot) return checkEmpty(e.from); });
    ctx.on("guild.uninstall", (e) => { for (const s of [...sessions.values()]) if (s.gid === e.gid) sessions.delete(s.cid); });

    // ---- survive a restart: save on stop, continue on start (if people are still in the channel)
    ctx.onUnload(async () => {
      const now = Date.now();
      const list = [...sessions.values()].map((s) => ({ ...s, pos: posOf(s, now), at: now }));
      if (list.length) await ctx.storage.set("sessions", { at: now, list });
    });
    // after 4 s: the voice channels are restored by then
    setTimeout(async () => {
      let saved: { at: number; list: Session[] } | undefined;
      try { saved = await ctx.storage.get("sessions"); if (saved) await ctx.storage.delete("sessions"); } catch { return; }
      if (!saved || Date.now() - saved.at > 10 * 60_000) return; // stale record
      for (const s of saved.list ?? []) {
        try {
          const ms = await ctx.voice.members(s.cid);
          if (!ms.some((m) => !m.bot) || sessions.has(s.cid)) continue;
          // the time the server was down counts as paused
          sessions.set(s.cid, { ...s, at: Date.now(), seq: s.seq + 1, ev: null });
          push(sessions.get(s.cid)!);
        } catch (e) {
          ctx.log.warn("couldn't restore a session", { cid: s.cid, error: String(e) });
        }
      }
    }, 4000);
  },
});
