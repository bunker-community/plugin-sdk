/*
 * Muzik Botu (plugin surumu). Cekirdekteki muzik botunun (music.ts) plugin'e tasinmis hali; deneme
 * asamasinda onunla yan yana calisir (ayni kanalda ikisini birden calistirma).
 *
 * Her ses kanalinda bagimsiz: sira (en fazla 50), duraklat/devam, atla, kapat, ses (varsayilan %10).
 * Calma cekirdekte (VoiceSession.playMedia: yt-dlp + ffmpeg, cerez/WARP/SoundCloud yedegi); calan sarki
 * baslayinca siradaki onceden cozulur (prefetch). Sunucu yeniden baslarken kanallarin durumu saklanir,
 * acilinca kaldigi yerden devam eder.
 * Pencere durumu (kanal basina): { now, queue, volume, paused, playing, elapsed, connecting, notice }.
 */
import { definePlugin, type MediaMeta, type PluginContext, type UiAction, type VoiceSession } from "@bunker-community/plugin-sdk";

const MAX_QUEUE = 50;
const DEFAULT_VOLUME = 10;

interface Track { q: string; title: string; artist?: string; duration?: number; thumb?: string; url?: string; by: string; byNick: string }
interface Chan {
  gid: string;
  cid: string;
  now: Track | null;
  queue: Track[];
  volume: number;
  /** calmaya basladigi an (duraklatmalar dusulmus); null = henuz ses gelmedi */
  startedAt: number | null;
  pausedAt: number | null;
  /** su anki sarki kacinci saniyeden baslatildi */
  seek: number;
  pauseOnStart: boolean;
  connecting: boolean;
  notice: string;
  noticeTimer?: ReturnType<typeof setTimeout>;
}
type Snapshot = { gid: string; cid: string; now: Track | null; elapsed: number; queue: Track[]; volume: number; paused: boolean }[];

function labelOf(q: string) {
  if (!/^https?:\/\//i.test(q)) return q.slice(0, 120);
  try { const u = new URL(q); return (u.hostname.replace(/^www\./, "") + u.pathname + (u.search.length < 30 ? u.search : "")).slice(0, 120); }
  catch { return q.slice(0, 120); }
}

export default definePlugin({
  setup(ctx: PluginContext) {
    const chans = new Map<string, Chan>();
    const elapsedOf = (c: Chan) => (c.startedAt ? ((c.pausedAt ?? Date.now()) - c.startedAt) / 1000 : c.seek);

    function push(c: Chan) {
      if (chans.get(c.cid) !== c) return;
      const n = c.now;
      ctx.ui.setState({ gid: c.gid, cid: c.cid }, {
        now: n ? { title: n.title, artist: n.artist ?? "", duration: n.duration ?? 0, thumb: n.thumb ?? "", url: n.url ?? "", byNick: n.byNick } : null,
        queue: c.queue.map((t) => ({ title: t.title, byNick: t.byNick })),
        volume: c.volume, paused: Boolean(c.pausedAt), playing: Boolean(c.startedAt), elapsed: Math.max(0, Math.round(elapsedOf(c) * 10) / 10),
        connecting: c.connecting, notice: c.notice, max: MAX_QUEUE,
      }, { live: Boolean(n) });
    }
    function notice(c: Chan, text: string) {
      c.notice = text;
      clearTimeout(c.noticeTimer);
      c.noticeTimer = setTimeout(() => { c.notice = ""; push(c); }, 10_000);
    }
    const sess = (c: Chan) => ctx.voice.session(c.cid);

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
        if (c.now) ctx.log.info(`çalıyor: ${c.now.title}`, { cid: c.cid });
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
        if (chans.get(c.cid) === c) { chans.delete(c.cid); ctx.ui.setState({ gid: c.gid, cid: c.cid }, null); }
      });
    }

    /** Kanalin oturumu (yoksa bot kanala girer) */
    async function ensure(gid: string, cid: string): Promise<Chan> {
      let c = chans.get(cid);
      if (c && sess(c)) return c;
      if (!c) {
        c = { gid, cid, now: null, queue: [], volume: DEFAULT_VOLUME, startedAt: null, pausedAt: null, seek: 0, pauseOnStart: false, connecting: true, notice: "" };
        chans.set(cid, c);
      }
      c.connecting = true;
      push(c);
      try {
        const s = await ctx.voice.join(cid);
        hook(c, s);
        s.setVolume(c.volume);
        return c;
      } catch (e) {
        chans.delete(cid);
        ctx.ui.setState({ gid, cid }, { now: null, queue: [], volume: DEFAULT_VOLUME, paused: false, playing: false, elapsed: 0, connecting: false, notice: (e as Error).message, max: MAX_QUEUE });
        throw e;
      } finally {
        c.connecting = false;
      }
    }

    async function onAction(a: UiAction) {
      if (!a.cid) return;
      const d = (a.data ?? {}) as Record<string, unknown>;
      const c = chans.get(a.cid);
      switch (a.name) {
        case "hello":
          if (c) push(c);
          else ctx.ui.setState({ gid: a.gid, cid: a.cid }, null);
          return;
        case "add": {
          const q = String(d.q ?? "").replace(/[\r\n\x00-\x1f]+/g, " ").trim().slice(0, 500);
          if (!q) return;
          if (c && c.queue.length >= MAX_QUEUE) { notice(c, `Sıra dolu (${MAX_QUEUE}).`); push(c); return; }
          const ch = await ensure(a.gid, a.cid);
          const t: Track = { q, title: labelOf(q), by: a.uid, byNick: a.nick };
          ch.queue.push(t);
          ctx.log.info(`${a.nick} istedi: ${t.title}`, { cid: a.cid, sira: ch.queue.length });
          if (!ch.now) next(ch);
          else { if (ch.queue.length === 1 && ch.startedAt) sess(ch)?.prefetch(q); push(ch); }
          return;
        }
      }
      if (!c) return;
      const s = sess(c);
      switch (a.name) {
        case "skip":
          if (!c.now) return;
          ctx.log.info(`${a.nick} atladı: ${c.now.title}`, { cid: c.cid });
          s?.stop();
          c.seek = 0;
          next(c);
          return;
        case "pause":
          if (c.now && !c.pausedAt) { c.pausedAt = Date.now(); s?.pause(); }
          break;
        case "resume":
          if (c.pausedAt) { if (c.startedAt) c.startedAt += Date.now() - c.pausedAt; c.pausedAt = null; s?.resume(); }
          break;
        case "volume":
          c.volume = Math.max(0, Math.min(100, Math.round(Number(d.v) || 0)));
          s?.setVolume(c.volume);
          break;
        case "remove": {
          const i = Number(d.i);
          if (Number.isInteger(i) && i >= 0 && i < c.queue.length) c.queue.splice(i, 1);
          break;
        }
        case "clear":
          c.queue = [];
          break;
        case "stop":
          ctx.log.info(`${a.nick} botu kapattı`, { cid: c.cid });
          await s?.leave();
          chans.delete(c.cid);
          ctx.ui.setState({ gid: c.gid, cid: c.cid }, null);
          return;
        default:
          return;
      }
      push(c);
    }
    ctx.ui.onAction(onAction);

    // ---- yeniden baslatma: kanallarin durumu saklanir, acilinca kaldigi yerden
    ctx.onUnload(async () => {
      const snap: Snapshot = [...chans.values()].filter((c) => c.now || c.queue.length).map((c) => ({
        gid: c.gid, cid: c.cid, now: c.now, elapsed: elapsedOf(c), queue: c.queue, volume: c.volume, paused: Boolean(c.pausedAt),
      }));
      if (snap.length) await ctx.storage.set("resume", { at: Date.now(), list: snap });
    });
    setTimeout(async () => {
      let saved: { at: number; list: Snapshot } | undefined;
      try { saved = await ctx.storage.get("resume"); await ctx.storage.delete("resume"); } catch { return; }
      if (!saved || Date.now() - saved.at > 10 * 60_000) return; // eski kayit: devam etme
      for (const r of saved.list) {
        try {
          const c = await ensure(r.gid, r.cid);
          c.volume = r.volume;
          sess(c)?.setVolume(r.volume);
          c.queue = r.queue;
          if (r.now) { c.queue.unshift(r.now); c.seek = Math.max(0, Math.floor(r.elapsed)); c.pauseOnStart = r.paused; }
          next(c);
          ctx.log.info(`kaldığı yerden devam: ${r.now?.title ?? "sıra"}`, { cid: r.cid });
        } catch (e) {
          ctx.log.warn(`devam edilemedi: ${(e as Error).message}`, { cid: r.cid });
        }
      }
    }, 4000);
  },
});
