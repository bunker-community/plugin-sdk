// Remote plugin: runs on your computer, connects to Bunker with a token (Settings -> Developer).
// BUNKER_TOKEN=<token> node index.js
import { connect, definePlugin } from "@bunker-community/plugin-sdk";

const plugin = definePlugin({
  setup(ctx) {
    ctx.command("roll", async (c) => {
      const sides = Math.max(2, Math.min(1000, Number(c.args) || 6));
      const n = ((await ctx.storage.get(`rolls:${c.uid}`)) ?? 0) + 1;
      await ctx.storage.set(`rolls:${c.uid}`, n);
      await c.reply(`${c.nick} rolled ${1 + Math.floor(Math.random() * sides)} (d${sides}, roll #${n})`);
    });
  },
});

connect(plugin, { token: process.env.BUNKER_TOKEN });
