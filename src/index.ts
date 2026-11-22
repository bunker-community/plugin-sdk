/*
 * @bunker-community/plugin-sdk: everything needed to write a Bunker plugin.
 *
 *   import { definePlugin } from "@bunker-community/plugin-sdk";
 *   export default definePlugin({
 *     setup(ctx) {
 *       ctx.command("hello", (c) => c.reply(`Hello ${c.nick}!`));
 *     },
 *   });
 *
 * Plugin folder: bunker-plugin.json (manifest) + entry file (default src/index.ts).
 * Remote plugin (runs on your own computer): connect(plugin, { token }) — see remote.ts, API_DOC.md.
 */
import type { PluginDefinition } from "./types.ts";

export * from "./types.ts";
export * from "./manifest.ts";
export * from "./version.ts";
export * from "./remote.ts";

/** Type helper: returns the plugin definition as is */
export function definePlugin(def: PluginDefinition): PluginDefinition {
  return def;
}
