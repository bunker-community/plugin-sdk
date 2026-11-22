/*
 * Music Bot (plugin). Replaced the core music bot on 2026-11-22.
 *
 * Independent in every voice channel: queue (at most 50), pause/resume, skip, stop, volume (default 10%).
 * Playback is in the core (VoiceSession.playMedia: yt-dlp + ffmpeg, cookie/WARP/SoundCloud fallback); when a song
 * starts the next one is decoded in advance (prefetch). While the server restarts the channels' state is saved,
 * and on start it continues where it left off.
 * Chat commands: !play !list !trmix !pause !resume !skip !stop !vol !queue !np !music (+ Turkish aliases: !çal !liste !devam !kuyruk !müzik...).
 * Replies are in the server's language (text.ts).
 * Playlists per server (storage "pl:<gid>"); built-in lists (lists/*.json) are added to every server once
 * ("seeded:<gid>"). The list's creator or someone with the server settings permission edits/deletes it.
 * Window state (per channel): { now, queue, volume, paused, playing, elapsed, connecting, notice, lists, max }.
 * While editing a list the songs only go to the editor (ctx.ui.send: { type: "pl", pl }); errors too
 * ({ type: "error", text }).
 */
import fs from "node:fs";
import { errorText, t, UserError } from "./text.ts";
import { definePlugin, type CommandCall, type MediaMeta, type PluginContext, type UiAction, type VoiceSession } from "@bunker-community/plugin-sdk";

const MAX_QUEUE = 50;
const DEFAULT_VOLUME = 10;
const MAX_LISTS = 30;
const MAX_SONGS = 500;
const PICK = 20;
/** Built-in lists added to every server once (don't come back if deleted) */
const BUILTIN = [{ id: "trmix", name: "TR Mix" }, { id: "edm", name: "EDM" }];
const SYSTEM = "BunkerMuzikBotu001";

interface Track { q: string; title: string; artist?: string; duration?: number; thumb?: string; url?: string; by: string; byNick: string }
interface Playlist { id: string; name: string; songs: string[]; by: string; created: number; updated: number }
interface Chan {
  gid: string;
  cid: string;
  now: Track | null;
  queue: Track[];
  volume: number;
  /** when it started playing (pauses subtracted); null = no audio yet */
  startedAt: number | null;
  pausedAt: number | null;
  /** which second the current song was started from */
  seek: number;
  pauseOnStart: boolean;
  connecting: boolean;
  notice: string;
  noticeTimer?: ReturnType<typeof setTimeout>;
}
type Snapshot = { gid: string; cid: string; now: Track | null; elapsed: number; queue: Track[]; volume: number; paused: boolean }[];
type ListView = { id: string; name: string; count: number; by: string }[];

function labelOf(q: string) {
  if (!/^https?:\/\//i.test(q)) return q.slice(0, 120);
  try { const u = new URL(q); return (u.hostname.replace(/^www\./, "") + u.pathname + (u.search.length < 30 ? u.search : "")).slice(0, 120); }
  catch { return q.slice(0, 120); }
}
const cleanQuery = (v: unknown) => String(v ?? "").replace(/[\r\n\x00-\x1f]+/g, " ").trim().slice(0, 500);
const fold = (s: string) => s.toLocaleLowerCase("tr").replace(/\s+/g, "");
const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export default definePlugin({
  setup(ctx: PluginContext) {
    const chans = new Map<string, Chan>();
    const elapsedOf = (c: Chan) => (c.startedAt ? ((c.pausedAt ?? Date.now()) - c.startedAt) / 1000 : c.seek);
    const sess = (c: Chan) => ctx.voice.session(c.cid);

    // ---------------------------------------------------------------- playlists
    const listCache = new Map<string, Playlist[]>();
    async function lists(gid: string): Promise<Playlist[]> {
      const hit = listCache.get(gid);
      if (hit) return hit;
      const arr = (await ctx.storage.get<Playlist[]>("pl:" + gid)) ?? [];
      const seeded = (await ctx.storage.get<string[]>("seeded:" + gid)) ?? [];
      const todo = BUILTIN.filter((b) => !seeded.includes(b.id));
      if (todo.length) {
        for (const b of todo) {
          try {
            const songs = JSON.parse(fs.readFileSync(new URL(`../lists/${b.id}.json`, import.meta.url), "utf8")) as string[];
            arr.push({ id: b.id + "-" + Date.now().toString(36), name: b.name, songs: songs.slice(0, MAX_SONGS), by: SYSTEM, created: Date.now(), updated: Date.now() });
          } catch (e) { ctx.log.warn(`could not add built-in list (${b.id}): ${(e as Error).message}`); }
        }
        await ctx.storage.set("seeded:" + gid, [...seeded, ...todo.map((b) => b.id)]);
        await ctx.storage.set("pl:" + gid, arr);
      }
      listCache.set(gid, arr);
      return arr;
    }
    const viewOf = (arr: Playlist[]): ListView => arr.map((p) => ({ id: p.id, name: p.name, count: p.songs.length, by: p.by }));
    const listView = async (gid: string) => viewOf(await lists(gid));
    async function saveLists(gid: string, arr: Playlist[]) {
      listCache.set(gid, arr);
      await ctx.storage.set("pl:" + gid, arr);
      const lv = viewOf(arr);
      lastLists.set(gid, lv);
      for (const c of chans.values()) if (c.gid === gid) push(c);
      for (const cid of idleIn.get(gid) ?? []) if (!chans.has(cid)) ctx.ui.setState({ gid, cid }, idleState(lv));
    }
    function cleanList(name: unknown, songs: unknown) {
      const n = String(name ?? "").replace(/[\r\n\x00-\x1f]+/g, " ").trim().slice(0, 40);
      if (!n) throw new UserError("listName");
      const raw = Array.isArray(songs) ? songs : String(songs ?? "").split("\n");
      const list = [...new Set(raw.map((x) => String(x ?? "").replace(/[\x00-\x1f]+/g, " ").trim().slice(0, 200)).filter(Boolean))];
      if (!list.length) throw new UserError("listEmpty");
      if (list.length > MAX_SONGS) throw new UserError("listTooLong", { n: MAX_SONGS });
      return { name: n, songs: list };
    }

    // ---------------------------------------------------------------- window state
    const lastLists = new Map<string, ListView>();
    /** channels without a bot whose window was opened (so the empty state updates when lists change) */
    const idleIn = new Map<string, Set<string>>();
    const idleState = (lv: ListView, notice = "") => ({ now: null, queue: [], volume: DEFAULT_VOLUME, paused: false, playing: false, elapsed: 0, connecting: false, notice, lists: lv, max: MAX_QUEUE });
    function push(c: Chan) {
      if (chans.get(c.cid) !== c) return;
      const n = c.now;
      ctx.ui.setState({ gid: c.gid, cid: c.cid }, {
        now: n ? { title: n.title, artist: n.artist ?? "", duration: n.duration ?? 0, thumb: n.thumb ?? "", url: n.url ?? "", byNick: n.byNick } : null,
        queue: c.queue.map((t) => ({ title: t.title, byNick: t.byNick })),
        volume: c.volume, paused: Boolean(c.pausedAt), playing: Boolean(c.startedAt), elapsed: Math.max(0, Math.round(elapsedOf(c) * 10) / 10),
        connecting: c.connecting, notice: c.notice, lists: lastLists.get(c.gid) ?? [], max: MAX_QUEUE,
      }, { live: Boolean(n) });
    }
    async function pushIdle(gid: string, cid: string, notice = "") {
      const lv = await listView(gid);
      lastLists.set(gid, lv);
      if (!idleIn.has(gid)) idleIn.set(gid, new Set());
      idleIn.get(gid)!.add(cid);
      ctx.ui.setState({ gid, cid }, idleState(lv, notice));
    }
    function notice(c: Chan, text: string) {
      c.notice = text;
      clearTimeout(c.noticeTimer);
      c.noticeTimer = setTimeout(() => { c.notice = ""; push(c); }, 10_000);
    }

    // ---------------------------------------------------------------- playback
    function next(c: Chan) {
      const s = sess(c);
      const t = c.queue.shift() ?? null;
      c.now = t;
      c.startedAt = null;
      c.pausedAt = null;
      if (!t) { c.seek = 0; c.pauseOnStart = false; push(c); return; }
      if (!s) { push(c); return; }
      s.playMedia(t.q, { seek: c.seek }).catch((e: Error) => {
        if (c.now !== t) return;
        notice(c, e.message);
        c.seek = 0;
        next(c);
      });
      push(c);
    }

    function hook(c: Chan, s: VoiceSession) {
      s.on("started", () => {
        c.startedAt = Date.now() - c.seek * 1000;
        c.pausedAt = null;
        if (c.pauseOnStart) { c.pauseOnStart = false; c.pausedAt = Date.now(); s.pause(); }
        c.seek = 0;
        if (c.queue[0]) s.prefetch(c.queue[0].q);
        if (c.now) ctx.log.info(`playing: ${c.now.title}`, { cid: c.cid });
        push(c);
      });
      s.on("meta", (m: MediaMeta) => {
        if (!c.now) return;
        c.now.title = m.title || c.now.title;
        c.now.artist = m.artist;
        c.now.duration = m.duration || undefined;
        c.now.thumb = m.thumb;
        c.now.url = m.url;
        push(c);
      });
      s.on("ended", () => { c.seek = 0; next(c); });
      s.on("error", (why, info) => {
        if (!info.silent) notice(c, why);
        c.seek = 0;
        next(c);
      });
      s.on("leave", () => {
        clearTimeout(c.noticeTimer);
        if (chans.get(c.cid) === c) { chans.delete(c.cid); void pushIdle(c.gid, c.cid); }
      });
    }

    /** The channel's session (the bot joins the channel if there is none) */
    async function ensure(gid: string, cid: string): Promise<Chan> {
      let c = chans.get(cid);
      if (c && sess(c)) return c;
      if (!c) {
        c = { gid, cid, now: null, queue: [], volume: DEFAULT_VOLUME, startedAt: null, pausedAt: null, seek: 0, pauseOnStart: false, connecting: true, notice: "" };
        chans.set(cid, c);
      }
      c.connecting = true;
      lastLists.set(gid, await listView(gid));
      push(c);
      try {
        const s = await ctx.voice.join(cid);
        hook(c, s);
        s.setVolume(c.volume);
        return c;
      } catch (e) {
        chans.delete(cid);
        void pushIdle(gid, cid, (e as Error).message);
        throw e;
      } finally {
        c.connecting = false;
      }
    }

    // ---------------------------------------------------------------- actions (shared by window and chat)
    async function addTrack(gid: string, cid: string, uid: string, nick: string, q: string) {
      const cur = chans.get(cid);
      if (cur && cur.queue.length >= MAX_QUEUE) throw new UserError("queueFull", { n: MAX_QUEUE });
      const c = await ensure(gid, cid);
      const wasPlaying = Boolean(c.now);
      const t: Track = { q, title: labelOf(q), by: uid, byNick: nick };
      c.queue.push(t);
      ctx.log.info(`${nick} requested: ${t.title}`, { cid, queue: c.queue.length });
      if (!c.now) next(c);
      else { if (c.queue.length === 1 && c.startedAt) sess(c)?.prefetch(q); push(c); }
      return { t, wasPlaying };
    }
    async function addPlaylist(gid: string, cid: string, uid: string, nick: string, pl: Playlist) {
      const room = MAX_QUEUE - (chans.get(cid)?.queue.length ?? 0);
      const pick = shuffle([...pl.songs]).slice(0, Math.max(0, Math.min(PICK, room)));
      if (!pick.length) throw new UserError("queueFull", { n: MAX_QUEUE });
      const c = await ensure(gid, cid);
      for (const q of pick) c.queue.push({ q, title: labelOf(q), by: uid, byNick: nick });
      ctx.log.info(`${nick} played the list: ${pl.name} (${pick.length})`, { cid });
      if (!c.now) next(c);
      else { if (c.startedAt) sess(c)?.prefetch(c.queue[0].q); push(c); }
      return pick.length;
    }
    function skip(c: Chan, nick: string) {
      if (!c.now) return false;
      ctx.log.info(`${nick} skipped: ${c.now.title}`, { cid: c.cid });
      sess(c)?.stop();
      c.seek = 0;
      next(c);
      return true;
    }
    function setPaused(c: Chan, paused: boolean) {
      if (!c.now) return false;
      if (paused && !c.pausedAt) { c.pausedAt = Date.now(); sess(c)?.pause(); }
      else if (!paused && c.pausedAt) { if (c.startedAt) c.startedAt += Date.now() - c.pausedAt; c.pausedAt = null; sess(c)?.resume(); }
      push(c);
      return true;
    }
    function setVolume(c: Chan, v: number) {
      c.volume = Math.max(0, Math.min(100, Math.round(v || 0)));
      sess(c)?.setVolume(c.volume);
      push(c);
    }
    async function stop(c: Chan, nick: string) {
      ctx.log.info(`${nick} stopped the bot`, { cid: c.cid });
      chans.delete(c.cid);
      await sess(c)?.leave();
      await pushIdle(c.gid, c.cid);
    }

    // ---------------------------------------------------------------- window
    async function onAction(a: UiAction) {
      if (!a.cid) return;
      const d = (a.data ?? {}) as Record<string, unknown>;
      const c = chans.get(a.cid);
      const where = { gid: a.gid, cid: a.cid };
      try {
        switch (a.name) {
          case "hello":
            if (c) { lastLists.set(a.gid, await listView(a.gid)); push(c); } else await pushIdle(a.gid, a.cid);
            return;
          case "add": {
            const q = cleanQuery(d.q);
            if (q) await addTrack(a.gid, a.cid, a.uid, a.nick, q);
            return;
          }
          case "pl.play": {
            const pl = (await lists(a.gid)).find((p) => p.id === d.id);
            if (!pl) throw new UserError("listNotFound");
            await addPlaylist(a.gid, a.cid, a.uid, a.nick, pl);
            return;
          }
          case "pl.get": {
            const pl = (await lists(a.gid)).find((p) => p.id === d.id);
            if (pl) ctx.ui.send(a.uid, where, { type: "pl", pl });
            return;
          }
          case "pl.save": {
            const arr = [...(await lists(a.gid))];
            const v = cleanList(d.name, d.songs);
            if (d.id) {
              const i = arr.findIndex((p) => p.id === d.id);
              if (i < 0) throw new UserError("listNotFound");
              if (arr[i].by !== a.uid && !a.manage) throw new UserError("onlyOwnerEdit");
              arr[i] = { ...arr[i], ...v, updated: Date.now() };
            } else {
              if (arr.length >= MAX_LISTS) throw new UserError("maxLists", { n: MAX_LISTS });
              arr.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...v, by: a.uid, created: Date.now(), updated: Date.now() });
            }
            await saveLists(a.gid, arr);
            ctx.ui.send(a.uid, where, { type: "saved" });
            return;
          }
          case "pl.delete": {
            const arr = await lists(a.gid);
            const pl = arr.find((p) => p.id === d.id);
            if (!pl) return;
            if (pl.by !== a.uid && !a.manage) throw new UserError("onlyOwnerDelete");
            await saveLists(a.gid, arr.filter((p) => p !== pl));
            return;
          }
        }
        if (!c) return;
        switch (a.name) {
          case "skip": skip(c, a.nick); return;
          case "pause": setPaused(c, true); return;
          case "resume": setPaused(c, false); return;
          case "volume": setVolume(c, Number(d.v)); return;
          case "remove": {
            const i = Number(d.i);
            if (Number.isInteger(i) && i >= 0 && i < c.queue.length) c.queue.splice(i, 1);
            push(c);
            return;
          }
          case "clear": c.queue = []; push(c); return;
          case "stop": await stop(c, a.nick); return;
        }
      } catch (e) {
        // The error only goes to this person's window
        ctx.ui.send(a.uid, where, { type: "error", text: errorText(e, a.lang) });
      }
    }
    ctx.ui.onAction(onAction);

    // ---------------------------------------------------------------- chat commands
    type Cmd = (c: CommandCall, chan: Chan | undefined, cid: string) => Promise<string | void>;
    function cmd(names: string[], fn: Cmd, voiceRequired = true) {
      for (const n of names) {
        ctx.command(n, async (c) => {
          // If the reply can't go out (rate limit etc.) it doesn't count as an error: the plugin's error budget must not fill up with a command flood
          const reply = async (text: string) => { try { await c.reply(text); } catch {} };
          let cid = "";
          if (voiceRequired) {
            const v = await ctx.voice.channelOf(c.uid);
            if (!v || v.gid !== c.gid) return reply(t(c.lang, "joinVoice"));
            cid = v.cid;
          }
          try {
            const out = await fn(c, cid ? chans.get(cid) : undefined, cid);
            if (out) await reply(out);
          } catch (e) {
            await reply(errorText(e, c.lang));
          }
        });
      }
    }
    // English names first; the Turkish ones are aliases people already use
    cmd(["music", "müzik", "muzik"], async (c) => t(c.lang, "help"), false);
    cmd(["play", "p", "çal", "cal"], async (c, _ch, cid) => {
      const q = cleanQuery(c.args);
      if (!q) return t(c.lang, "whatToPlay");
      const r = await addTrack(c.gid, cid, c.uid, c.nick, q);
      return t(c.lang, r.wasPlaying ? "queued" : "playing", { title: r.t.title });
    });
    cmd(["list", "liste", "playlist", "trmix"], async (c, _ch, cid) => {
      const want = /^!trmix\b/i.test(c.m.text.trim()) ? "TR Mix" : c.args;
      const arr = await lists(c.gid);
      if (!want) return arr.length ? t(c.lang, "lists", { names: arr.map((p) => p.name).join(", "), first: arr[0].name }) : t(c.lang, "noLists");
      const pl = arr.find((p) => fold(p.name) === fold(want));
      if (!pl) return t(c.lang, "noSuchList", { want, names: arr.map((p) => p.name).join(", ") || "-" });
      const n = await addPlaylist(c.gid, cid, c.uid, c.nick, pl);
      return t(c.lang, "listQueued", { n, name: pl.name });
    });
    cmd(["pause", "duraklat"], async (c, ch) => (ch && setPaused(ch, true) ? t(c.lang, "paused", { nick: c.nick }) : t(c.lang, "nothingPlaying")));
    cmd(["resume", "devam"], async (c, ch) => (ch && setPaused(ch, false) ? t(c.lang, "resumed") : t(c.lang, "nothingPlaying")));
    cmd(["skip", "next", "geç", "gec"], async (c, ch) => {
      const title = ch?.now?.title ?? "";
      return ch && skip(ch, c.nick) ? t(c.lang, "skipped", { title }) : t(c.lang, "nothingPlaying");
    });
    cmd(["stop", "dur"], async (c, ch) => {
      if (!ch) return t(c.lang, "alreadyOff");
      await stop(ch, c.nick);
      return t(c.lang, "stopped", { nick: c.nick });
    });
    cmd(["vol", "volume", "ses"], async (c, ch) => {
      if (!ch) return t(c.lang, "notHere");
      if (!c.args) return t(c.lang, "volume", { v: ch.volume });
      setVolume(ch, Number(c.args.replace("%", "")));
      return t(c.lang, "volumeSet", { v: ch.volume });
    });
    cmd(["queue", "kuyruk"], async (c, ch) => {
      if (!ch?.now && !ch?.queue.length) return t(c.lang, "queueEmpty");
      return [ch.now ? t(c.lang, "playing", { title: ch.now.title }) : "", ch.queue.length ? t(c.lang, "queueHead", { n: ch.queue.length }) : "",
        ...ch.queue.slice(0, 10).map((x, i) => `${i + 1}. ${x.title}`), ch.queue.length > 10 ? "…" : ""].filter(Boolean).join("\n");
    });
    cmd(["np", "çalan", "calan"], async (c, ch) => (ch?.now ? t(c.lang, "nowPlaying", { title: ch.now.title, nick: ch.now.byNick }) : t(c.lang, "nothingPlaying")));

    // Delete the playlists when removed from the server
    ctx.on("guild.uninstall", async ({ gid }) => {
      listCache.delete(gid);
      idleIn.delete(gid);
      await ctx.storage.delete("pl:" + gid);
      await ctx.storage.delete("seeded:" + gid);
    });

    // ---------------------------------------------------------------- restart: continue where it left off
    ctx.onUnload(async () => {
      const snap: Snapshot = [...chans.values()].filter((c) => c.now || c.queue.length).map((c) => ({
        gid: c.gid, cid: c.cid, now: c.now, elapsed: elapsedOf(c), queue: c.queue, volume: c.volume, paused: Boolean(c.pausedAt),
      }));
      if (snap.length) await ctx.storage.set("resume", { at: Date.now(), list: snap });
    });
    setTimeout(async () => {
      let saved: { at: number; list: Snapshot } | undefined;
      try { saved = await ctx.storage.get("resume"); await ctx.storage.delete("resume"); } catch { return; }
      if (!saved || Date.now() - saved.at > 10 * 60_000) return; // stale record: don't continue
      for (const r of saved.list) {
        try {
          const c = await ensure(r.gid, r.cid);
          c.volume = r.volume;
          sess(c)?.setVolume(r.volume);
          c.queue = r.queue;
          if (r.now) { c.queue.unshift(r.now); c.seek = Math.max(0, Math.floor(r.elapsed)); c.pauseOnStart = r.paused; }
          next(c);
          ctx.log.info(`continuing where it left off: ${r.now?.title ?? "queue"}`, { cid: r.cid });
        } catch (e) {
          ctx.log.warn(`could not continue: ${(e as Error).message}`, { cid: r.cid });
        }
      }
    }, 4000);
  },
});
