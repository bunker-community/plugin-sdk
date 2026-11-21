/*
 * Radyo: SDK'nin ses (ctx.voice) ve pencere (ctx.ui) ornegi.
 * Pencereden bir yayin/ses adresi verilir; plugin kisinin bulundugu ses kanalina katilip calar.
 * Durum kanal basina: { url, label, playing, paused, volume, by, error }. Son calinanlar sunucu basina depoda.
 */
import { definePlugin, type PluginContext, type VoiceSession } from "@bunker-community/plugin-sdk";

interface Now { url: string; label: string; playing: boolean; paused: boolean; volume: number; by: string; error: string }
type Recent = { url: string; label: string }[];

const labelOf = (url: string) => { try { const u = new URL(url); return (u.hostname.replace(/^www\./, "") + u.pathname).slice(0, 60); } catch { return url.slice(0, 60); } };

export default definePlugin({
  setup(ctx: PluginContext) {
    /** cid -> kanal durumu */
    const now = new Map<string, Now & { gid: string }>();

    const recent = async (gid: string) => (await ctx.storage.get<Recent>("recent:" + gid)) ?? [];
    const push = async (gid: string, cid: string) => {
      const n = now.get(cid);
      ctx.ui.setState({ gid, cid }, { now: n ? { url: n.url, label: n.label, playing: n.playing, paused: n.paused, volume: n.volume, by: n.by, error: n.error } : null, recent: await recent(gid) }, { live: Boolean(n?.playing) });
    };
    const hook = (s: VoiceSession) => {
      s.on("started", () => { const n = now.get(s.cid); if (n) { n.error = ""; n.playing = true; void push(s.gid, s.cid); } });
      s.on("ended", () => { const n = now.get(s.cid); if (n) { n.playing = false; void push(s.gid, s.cid); } });
      s.on("error", (why) => { const n = now.get(s.cid); if (n) { n.playing = false; n.error = why; void push(s.gid, s.cid); } });
      s.on("leave", () => { now.delete(s.cid); void push(s.gid, s.cid); });
    };

    ctx.ui.onAction(async (a) => {
      if (!a.cid) return;
      const d = (a.data ?? {}) as Record<string, unknown>;
      const n = now.get(a.cid);
      if (a.name === "play") {
        const url = String(d.url ?? "").trim().slice(0, 500);
        if (!/^https?:\/\//i.test(url)) return;
        const fresh = !ctx.voice.session(a.cid);
        const s = await ctx.voice.join(a.cid);
        if (fresh) hook(s);
        const label = labelOf(url);
        now.set(a.cid, { gid: a.gid, url, label, playing: false, paused: false, volume: n?.volume ?? 30, by: a.nick, error: "" });
        s.setVolume(n?.volume ?? 30);
        try { await s.playUrl(url); }
        catch (e) { const x = now.get(a.cid); if (x) x.error = (e as Error).message; }
        const list = (await recent(a.gid)).filter((r) => r.url !== url);
        list.unshift({ url, label });
        await ctx.storage.set("recent:" + a.gid, list.slice(0, 8));
        ctx.log.info(`${a.nick} çaldı: ${label}`, { gid: a.gid, cid: a.cid });
      } else if (a.name === "volume" && n) {
        n.volume = Math.max(0, Math.min(100, Math.round(Number(d.v) || 0)));
        ctx.voice.session(a.cid)?.setVolume(n.volume);
      } else if (a.name === "pause" && n) {
        ctx.voice.session(a.cid)?.pause(); n.paused = true;
      } else if (a.name === "resume" && n) {
        ctx.voice.session(a.cid)?.resume(); n.paused = false;
      } else if (a.name === "stop") {
        await ctx.voice.session(a.cid)?.leave();
        now.delete(a.cid);
      } else if (a.name === "forget") {
        const url = String(d.url ?? "");
        await ctx.storage.set("recent:" + a.gid, (await recent(a.gid)).filter((r) => r.url !== url));
      } else if (a.name !== "hello") return;
      await push(a.gid, a.cid);
    });

    ctx.on("guild.uninstall", async ({ gid }) => { await ctx.storage.delete("recent:" + gid); });
  },
});
