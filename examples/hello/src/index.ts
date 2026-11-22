/* Example plugin: shows the SDK's basic parts (command, event, storage, writing to a channel). */
import { definePlugin, type CommandCall } from "@bunker-community/plugin-sdk";

export default definePlugin({
  setup(ctx) {
    // Replies in the server's language (c.lang); "merhaba" stays as an alias
    const greet = async (c: CommandCall) => {
      const key = `count:${c.uid}`;
      const n = ((await ctx.storage.get<number>(key)) ?? 0) + 1;
      await ctx.storage.set(key, n);
      if (c.lang === "tr") await c.reply(n === 1 ? `Merhaba ${c.nick}!` : `Merhaba ${c.nick}! Bu ${n}. selamın.`);
      else await c.reply(n === 1 ? `Hello ${c.nick}!` : `Hello ${c.nick}! That's greeting number ${n}.`);
    };
    ctx.command("hello", greet);
    ctx.command("merhaba", greet);

    ctx.on("member.join", (e) => {
      ctx.log.info("new member", { gid: e.gid, uid: e.uid });
    });

    // When added to / removed from a server (no permission needed)
    ctx.on("guild.install", (e) => ctx.log.info("added to a server", { gid: e.gid, by: e.by }));
    ctx.on("guild.uninstall", (e) => ctx.log.info("removed from a server", { gid: e.gid }));

    ctx.log.info("ready");
  },
});
