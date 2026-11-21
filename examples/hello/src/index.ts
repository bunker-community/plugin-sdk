/* Ornek plugin: SDK'nin temel parcalarini gosterir (komut, olay, depo, kanala yazma). */
import { definePlugin } from "@bunker-community/plugin-sdk";

export default definePlugin({
  setup(ctx) {
    ctx.command("merhaba", async (c) => {
      const key = `count:${c.uid}`;
      const n = ((await ctx.storage.get<number>(key)) ?? 0) + 1;
      await ctx.storage.set(key, n);
      await c.reply(n === 1 ? `Merhaba ${c.nick}!` : `Merhaba ${c.nick}! Bu ${n}. selamın.`);
    });

    ctx.on("member.join", (e) => {
      ctx.log.info("yeni üye", { gid: e.gid, uid: e.uid });
    });

    // Sunucuya eklenince / cikarilinca (izin gerekmez)
    ctx.on("guild.install", (e) => ctx.log.info("sunucuya eklendi", { gid: e.gid, by: e.by }));
    ctx.on("guild.uninstall", (e) => ctx.log.info("sunucudan çıkarıldı", { gid: e.gid }));

    ctx.log.info("hazır");
  },
});
