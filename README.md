# Bunker Plugin SDK

[![npm](https://img.shields.io/npm/v/@bunker-community/plugin-sdk)](https://www.npmjs.com/package/@bunker-community/plugin-sdk)

Write bots and plugins for [Bunker](https://bunker.community): commands, events, storage, voice (music/radio) and a
window in the Bunker panel. Write a file, upload it in Bunker, it runs.

**Developer guide and API reference:** [API_DOC.md](API_DOC.md) · [web](https://bunker.community/app/sdk/) · [PDF](docs/bunker-plugin-api.pdf)

## Quick start

`bunker-plugin.json`
```json
{ "name": "Dice Bot", "version": "1.0.0", "sdk": "0.1", "permissions": ["events.messages", "chat.send"] }
```

`plugin.js`
```js
import { definePlugin } from "@bunker-community/plugin-sdk";

export default definePlugin({
  setup(ctx) {
    ctx.command("roll", (c) => c.reply(`${c.nick} rolled ${1 + Math.floor(Math.random() * 6)}`));
  },
});
```

1. In Bunker: **Settings → Developer → New plugin**.
2. **Upload code**: select `plugin.js` and `bunker-plugin.json`, then **Run on Bunker**.
3. Add it to your server (Server settings → Plugins) and type `!roll`.

Plugins run in a restricted environment (no internet or file access, single file, only this SDK). To test from your
own computer instead, install the SDK (`npm install @bunker-community/plugin-sdk`) and use `connect(plugin, { token })`;
see the guide.

Examples: [examples/dice](examples/dice) (start here), `hello`, `radio`, `music` (Bunker's own plugins, same API).

## License

MIT. This repository is published from the Bunker monorepo; issues and pull requests are welcome here.
