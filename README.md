# Bunker Plugin SDK

[![npm](https://img.shields.io/npm/v/@bunker-community/plugin-sdk)](https://www.npmjs.com/package/@bunker-community/plugin-sdk)

Write bots and plugins for [Bunker](https://bunker.community): commands, events, storage, voice (music/radio) and
a window in the Bunker panel. Your code runs on your own computer or server and connects with a token; or Bunker
hosts it after review.

**Docs:** [English](API.en.md) · [Türkçe](API.md) · [web](https://bunker.community/app/sdk/en) · PDF ([EN](docs/bunker-plugin-api-en.pdf), [TR](docs/bunker-plugin-api.pdf))

## Quick start

1. In Bunker: **Settings → Developer → New plugin**, copy the token.
2. Install (Node.js 22+):

```bash
npm install @bunker-community/plugin-sdk
```

3. `index.js` (with `"type": "module"` in package.json):

```js
import { connect, definePlugin } from "@bunker-community/plugin-sdk";

const plugin = definePlugin({
  setup(ctx) {
    ctx.command("hello", (c) => c.reply(`Hello ${c.nick}!`));
  },
});

connect(plugin, { token: process.env.BUNKER_TOKEN });
```

4. Add a `bunker-plugin.json` (name, version, `"sdk": "0.1"`, permissions) next to it, run
   `BUNKER_TOKEN=<token> node index.js`, then add the plugin to your server from Server settings → Plugins.

See [examples/](examples): `remote-dice` (remote plugin), `hello`, `radio`, `music` (built-in plugins, same API).

## License

MIT. This repository is published from the Bunker monorepo; issues and pull requests are welcome here.
