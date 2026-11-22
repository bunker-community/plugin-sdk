/*
 * Muzik Botu (plugin). 2026-11-22'de cekirdek muzik botunun yerini aldi.
 *
 * Her ses kanalinda bagimsiz: sira (en fazla 50), duraklat/devam, atla, kapat, ses (varsayilan %10).
 * Calma cekirdekte (VoiceSession.playMedia: yt-dlp + ffmpeg, cerez/WARP/SoundCloud yedegi); calan sarki
 * baslayinca siradaki onceden cozulur (prefetch). Sunucu yeniden baslarken kanallarin durumu saklanir,
 * acilinca kaldigi yerden devam eder.
 * Sohbet komutlari: !play !liste !trmix !pause !devam !skip !stop !vol !kuyruk !np !müzik (+ eski takma adlar).
 * Calma listeleri sunucu basina (depo "pl:<gid>"); hazir listeler (lists/*.json) her sunucuya bir kez eklenir
 * ("seeded:<gid>"). Listeyi olusturan ya da sunucu ayarlari yetkisi olan duzenler/siler.
 * Pencere durumu (kanal basina): { now, queue, volume, paused, playing, elapsed, connecting, notice, lists, max }.
 * Liste duzenlerken sarkilar sadece duzenleyene gider (ctx.ui.send: { type: "pl", pl }); hatalar da
 * ({ type: "error", text }).
 */
import fs from "node:fs";
import { definePlugin, type CommandCall, type MediaMeta, type PluginContext, type UiAction, type VoiceSession } from "@bunker-community/plugin-sdk";

const MAX_QUEUE = 50;
const DEFAULT_VOLUME = 10;
const MAX_LISTS = 30;
const MAX_SONGS = 500;
const PICK = 20;
/** Her sunucuya bir kez eklenen hazir listeler (silinirse geri gelmez) */
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

    // ---------------------------------------------------------------- calma listeleri
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
          } catch (e) { ctx.log.warn(`hazır liste eklenemedi (${b.id}): ${(e as Error).message}`); }
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
      if (!n) throw new Error("Listeye bir ad ver.");
      const raw = Array.isArray(songs) ? songs : String(songs ?? "").split("\n");
      const list = [...new Set(raw.map((x) => String(x ?? "").replace(/[\x00-\x1f]+/g, " ").trim().slice(0, 200)).filter(Boolean))];
      if (!list.length) throw new Error("Listeye en az bir şarkı ekle (her satıra bir şarkı adı ya da bağlantı).");
      if (list.length > MAX_SONGS) throw new Error(`Bir listede en fazla ${MAX_SONGS} şarkı olabilir.`);
      return { name: n, songs: list };
    }

    // ---------------------------------------------------------------- pencere durumu
    const lastLists = new Map<string, ListView>();
    /** bot olmayan ama penceresi acilmis kanallar (listeler degisince bos durum guncellensin) */
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

    // ---------------------------------------------------------------- calma
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
        if (chans.get(c.cid) === c) { chans.delete(c.cid); void pushIdle(c.gid, c.cid); }
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

    // ---------------------------------------------------------------- islemler (pencere ve sohbet ortak)
    async function addTrack(gid: string, cid: string, uid: string, nick: string, q: string) {
      const cur = chans.get(cid);
      if (cur && cur.queue.length >= MAX_QUEUE) throw new Error(`Sıra dolu (${MAX_QUEUE}).`);
      const c = await ensure(gid, cid);
      const wasPlaying = Boolean(c.now);
      const t: Track = { q, title: labelOf(q), by: uid, byNick: nick };
      c.queue.push(t);
      ctx.log.info(`${nick} istedi: ${t.title}`, { cid, sira: c.queue.length });
      if (!c.now) next(c);
      else { if (c.queue.length === 1 && c.startedAt) sess(c)?.prefetch(q); push(c); }
      return { t, wasPlaying };
    }
    async function addPlaylist(gid: string, cid: string, uid: string, nick: string, pl: Playlist) {
      const room = MAX_QUEUE - (chans.get(cid)?.queue.length ?? 0);
      const pick = shuffle([...pl.songs]).slice(0, Math.max(0, Math.min(PICK, room)));
      if (!pick.length) throw new Error(`Sıra dolu (${MAX_QUEUE}).`);
      const c = await ensure(gid, cid);
      for (const q of pick) c.queue.push({ q, title: labelOf(q), by: uid, byNick: nick });
      ctx.log.info(`${nick} listeyi çaldı: ${pl.name} (${pick.length})`, { cid });
      if (!c.now) next(c);
      else { if (c.startedAt) sess(c)?.prefetch(c.queue[0].q); push(c); }
      return pick.length;
    }
    function skip(c: Chan, nick: string) {
      if (!c.now) return false;
      ctx.log.info(`${nick} atladı: ${c.now.title}`, { cid: c.cid });
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
      ctx.log.info(`${nick} botu kapattı`, { cid: c.cid });
      chans.delete(c.cid);
      await sess(c)?.leave();
      await pushIdle(c.gid, c.cid);
    }

    // ---------------------------------------------------------------- pencere
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
            if (!pl) throw new Error("Liste bulunamadı.");
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
              if (i < 0) throw new Error("Liste bulunamadı.");
              if (arr[i].by !== a.uid && !a.manage) throw new Error("Bu listeyi sadece oluşturan ya da sunucu yöneticisi düzenleyebilir.");
              arr[i] = { ...arr[i], ...v, updated: Date.now() };
            } else {
              if (arr.length >= MAX_LISTS) throw new Error(`Bir sunucuda en fazla ${MAX_LISTS} liste olabilir.`);
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
            if (pl.by !== a.uid && !a.manage) throw new Error("Bu listeyi sadece oluşturan ya da sunucu yöneticisi silebilir.");
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
        // Hata sadece bu kisinin penceresine
        ctx.ui.send(a.uid, where, { type: "error", text: (e as Error).message });
      }
    }
    ctx.ui.onAction(onAction);

    // ---------------------------------------------------------------- sohbet komutlari
    const HELP = "Komutlar: [b]!play[/b] <şarkı/bağlantı>, [b]!liste[/b] <liste adı>, [b]!pause[/b], [b]!devam[/b], [b]!skip[/b], [b]!stop[/b], [b]!vol[/b] <0-100>, [b]!kuyruk[/b], [b]!np[/b]. Bu sunucunun bir ses kanalındayken yaz. Pencere: sol alttaki müzik ikonu.";
    type Cmd = (c: CommandCall, chan: Chan | undefined, cid: string) => Promise<string | void>;
    function cmd(names: string[], fn: Cmd, voiceRequired = true) {
      for (const n of names) {
        ctx.command(n, async (c) => {
          // Cevap gidemezse (hiz siniri vb.) hata sayilmasin: plugin'in hata butcesi komut yagmuruyla dolmasin
          const reply = async (t: string) => { try { await c.reply(t); } catch {} };
          let cid = "";
          if (voiceRequired) {
            const v = await ctx.voice.channelOf(c.uid);
            if (!v || v.gid !== c.gid) return reply("Önce bu sunucunun bir ses kanalına katıl.");
            cid = v.cid;
          }
          try {
            const out = await fn(c, cid ? chans.get(cid) : undefined, cid);
            if (out) await reply(out);
          } catch (e) {
            await reply((e as Error).message);
          }
        });
      }
    }
    cmd(["müzik", "muzik"], async () => HELP, false);
    cmd(["play", "p", "çal", "cal"], async (c, _ch, cid) => {
      const q = cleanQuery(c.args);
      if (!q) return "Ne çalayım? Örnek: [b]!play mor ve ötesi cambaz[/b]";
      const r = await addTrack(c.gid, cid, c.uid, c.nick, q);
      return r.wasPlaying ? `Sıraya eklendi: ${r.t.title}` : `Çalıyor: ${r.t.title}`;
    });
    cmd(["liste", "list", "playlist", "trmix"], async (c, _ch, cid) => {
      const want = /^!trmix\b/i.test(c.m.text.trim()) ? "TR Mix" : c.args;
      const arr = await lists(c.gid);
      if (!want) return arr.length ? `Listeler: ${arr.map((p) => p.name).join(", ")}. Örnek: [b]!liste ${arr[0].name}[/b]` : "Bu sunucuda liste yok.";
      const pl = arr.find((p) => fold(p.name) === fold(want));
      if (!pl) return `"${want}" adında liste yok. Listeler: ${arr.map((p) => p.name).join(", ") || "-"}`;
      const n = await addPlaylist(c.gid, cid, c.uid, c.nick, pl);
      return `${pl.name} listesinden ${n} şarkı sıraya eklendi`;
    });
    cmd(["pause", "duraklat"], async (c, ch) => (ch && setPaused(ch, true) ? `${c.nick} müziği duraklattı` : "Şu an bir şey çalmıyor."));
    cmd(["resume", "devam"], async (_c, ch) => (ch && setPaused(ch, false) ? "Devam ediyor" : "Şu an bir şey çalmıyor."));
    cmd(["skip", "next", "geç", "gec"], async (c, ch) => {
      const title = ch?.now?.title;
      return ch && skip(ch, c.nick) ? `Geçildi: ${title}` : "Şu an bir şey çalmıyor.";
    });
    cmd(["stop", "dur"], async (c, ch) => {
      if (!ch) return "Bot zaten kapalı.";
      await stop(ch, c.nick);
      return `${c.nick} müziği kapattı`;
    });
    cmd(["vol", "volume", "ses"], async (c, ch) => {
      if (!ch) return "Bot bu kanalda değil.";
      if (!c.args) return `Bot sesi: %${ch.volume}`;
      setVolume(ch, Number(c.args.replace("%", "")));
      return `Bot sesi %${ch.volume}`;
    });
    cmd(["queue", "kuyruk"], async (_c, ch) => {
      if (!ch?.now && !ch?.queue.length) return "Kuyruk boş.";
      return [ch.now ? `Çalıyor: ${ch.now.title}` : "", ch.queue.length ? `Sırada (${ch.queue.length}):` : "",
        ...ch.queue.slice(0, 10).map((t, i) => `${i + 1}. ${t.title}`), ch.queue.length > 10 ? "…" : ""].filter(Boolean).join("\n");
    });
    cmd(["np", "çalan", "calan"], async (_c, ch) => (ch?.now ? `Çalıyor: ${ch.now.title} (${ch.now.byNick} ekledi)` : "Şu an bir şey çalmıyor."));

    // Sunucudan cikarilinca listeleri sil
    ctx.on("guild.uninstall", async ({ gid }) => {
      listCache.delete(gid);
      idleIn.delete(gid);
      await ctx.storage.delete("pl:" + gid);
      await ctx.storage.delete("seeded:" + gid);
    });

    // ---------------------------------------------------------------- yeniden baslatma: kaldigi yerden
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
