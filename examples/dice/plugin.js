// Upload this file + bunker-plugin.json in Bunker: Settings -> Developer -> Upload code -> Run on Bunker.
import { definePlugin } from "@bunker-community/plugin-sdk";

export default definePlugin({
  setup(ctx) {
    ctx.command("roll", async (c) => {
      const sides = Math.max(2, Math.min(1000, Number(c.args) || 6));
      const n = ((await ctx.storage.get(`rolls:${c.gid}:${c.uid}`)) ?? 0) + 1;
      await ctx.storage.set(`rolls:${c.gid}:${c.uid}`, n);
      await c.reply(`${c.nick} rolled ${1 + Math.floor(Math.random() * sides)} (d${sides}, roll #${n})`);
    });
  },
});
