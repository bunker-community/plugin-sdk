/*
 * @bunker-community/plugin-sdk: Bunker plugin'i yazmak icin gereken her sey.
 *
 *   import { definePlugin } from "@bunker-community/plugin-sdk";
 *   export default definePlugin({
 *     setup(ctx) {
 *       ctx.command("merhaba", (c) => c.reply(`Merhaba ${c.nick}!`));
 *     },
 *   });
 *
 * Plugin klasoru: bunker-plugin.json (manifest) + giris dosyasi (varsayilan src/index.ts).
 * Uzak plugin (kendi bilgisayarinda calisir): connect(plugin, { token }) — bkz. remote.ts, API_DOC.md.
 */
import type { PluginDefinition } from "./types.ts";

export * from "./types.ts";
export * from "./manifest.ts";
export * from "./version.ts";
export * from "./remote.ts";

/** Tip yardimcisi: plugin tanimini oldugu gibi dondurur */
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def;
}
