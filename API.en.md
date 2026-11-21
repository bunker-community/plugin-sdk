# Bunker Plugin SDK (`@bunker-community/plugin-sdk` 0.1.4)

API reference for writing Bunker bots / plugins. (Türkçe: [API.md](API.md))

A plugin runs in one of two ways; **the code and the API are the same** (`definePlugin({ setup(ctx) {…} })`):

| | Remote plugin (anyone) | Built into Bunker (first party) |
|---|---|---|
| Where the code runs | On your computer / server, or, once approved, in a restricted process on Bunker ([hosting](#running-on-bunker-hosting)) | On the Bunker server, `plugins/<id>/` |
| Connection | `connect(plugin, { token })` → gateway (WebSocket) | Loaded by Bunker |
| Who adds it | You: Settings → Developer | The Bunker team (repo + deploy) |
| Which servers | While unverified, only servers you manage; once the site admin lists it in the Store (verified), everyone | Everyone, once the site admin lists it |
| Difference | Cannot send raw PCM to voice channels (no `playPcm`); the bot shows offline while your code is not running | — |

## Contents
1. [Quick start](#quick-start)
2. [Manifest: `bunker-plugin.json`](#manifest-bunker-pluginjson)
3. [Permissions](#permissions)
4. [Lifecycle](#lifecycle)
5. [`PluginContext` (ctx)](#plugincontext-ctx)
6. [Events](#events)
7. [Commands](#commands)
8. [Sending messages](#sending-messages)
9. [Storage](#storage)
10. [Voice](#voice)
11. [Window (panel UI)](#window-panel-ui)
12. [Running on Bunker (hosting)](#running-on-bunker-hosting)
13. [Limits](#limits)
14. [Versions and compatibility](#versions-and-compatibility)
15. [Publishing and adding to servers](#publishing-and-adding-to-servers)
16. [Gateway protocol (connecting without the SDK)](#gateway-protocol-connecting-without-the-sdk)
17. [Examples](#examples)

---

## Quick start

### Remote plugin (on your own computer)

1. In Bunker, **Settings → Developer → New plugin**: type a name, click "Create". Copy the **token** shown
   (it is shown only once; if you lose it, use "Regenerate token").
2. In an empty folder (Node.js 22+):

```bash
npm init -y
npm install @bunker-community/plugin-sdk
```

Add `"type": "module"` to `package.json`. Create two files:

`bunker-plugin.json` (no id: it comes from the token)
```json
{
  "name": "Hello Bot",
  "version": "0.1.0",
  "description": "Replies to !hello.",
  "sdk": "0.1",
  "permissions": ["events.messages", "chat.send", "storage"]
}
```

`index.js`
```js
import { connect, definePlugin } from "@bunker-community/plugin-sdk";

const plugin = definePlugin({
  setup(ctx) {
    ctx.command("hello", async (c) => {
      const n = ((await ctx.storage.get(`n:${c.uid}`)) ?? 0) + 1;
      await ctx.storage.set(`n:${c.uid}`, n);
      await c.reply(`Hello ${c.nick}! (${n} times)`);
    });
  },
});

connect(plugin, { token: process.env.BUNKER_TOKEN });
```

3. Run it: `BUNKER_TOKEN=<token> node index.js` (PowerShell: `$env:BUNKER_TOKEN="<token>"; node index.js`).
   Once it prints "bağlandı" (connected), the plugin shows "Connected" under Settings → Developer.
4. On your server: **Server settings → Plugins** (or the Plugin Store) → Add → approve the permissions.
   Type `!hello` in a channel.

Types are included for TypeScript (`import type { PluginContext } from "@bunker-community/plugin-sdk"`).

`connect(plugin, options)`:

| Option | Description |
|---|---|
| `token` | Required. Don't put the token in code; read it from an environment variable. |
| `url` | Gateway address, default `wss://bunker.community/app/api/plugin/gateway`. |
| `manifest` | Manifest object. If omitted, `bunker-plugin.json` in `dir` is read; if that is missing too, the manifest stored on Bunker is used. |
| `dir` | Folder of `bunker-plugin.json` and the window page (default: working directory). |
| `uiPage` | HTML of the window page (if omitted, the `manifest.ui.page` file is read from `dir`). |
| `logger` | Connection logs (default `console`). |

Returns `{ ready: Promise<void>, connected: boolean, close(): Promise<void> }`. If the connection drops it
reconnects by itself (waiting 1 s → 30 s), re-registering listeners and commands. It does not retry and `ready`
rejects if the token is invalid, the plugin was disabled, the manifest is invalid, or another connection was
opened with the same token.

The manifest and window page are sent on every connect and updated on Bunker if they changed. If you add a new
permission, the plugin stops working on servers where it is installed until it is approved again there.

While your code is not running: the bot shows offline in the member list, commands get no reply, voice
sessions close. To keep it always on, run it on a server (VPS, Raspberry Pi…) with `pm2` or systemd, or let
[Bunker host it](#running-on-bunker-hosting).

### Built into Bunker (first party)

```
plugins/hello/
├── bunker-plugin.json
├── package.json
├── tsconfig.json
└── src/index.ts
```

`bunker-plugin.json`
```json
{
  "id": "hello",
  "name": "Hello Bot",
  "version": "0.1.0",
  "description": "Replies to !hello.",
  "author": "Your Name",
  "sdk": "0.1",
  "permissions": ["events.messages", "chat.send", "storage"]
}
```

`package.json`
```json
{ "name": "@bunker/plugin-hello", "version": "0.1.0", "type": "module", "private": true,
  "dependencies": { "@bunker-community/plugin-sdk": "*" } }
```

`tsconfig.json`
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "*.ts"] }
```

`src/index.ts`
```ts
import { definePlugin } from "@bunker-community/plugin-sdk";

export default definePlugin({
  setup(ctx) {
    ctx.command("hello", async (c) => {
      const n = ((await ctx.storage.get<number>(`n:${c.uid}`)) ?? 0) + 1;
      await ctx.storage.set(`n:${c.uid}`, n);
      await c.reply(`Hello ${c.nick}! (${n} times)`);
    });
  },
});
```

Then run `npm install` at the repo root, add the folder to the root `package.json` → `typecheck` script, run
`npm run typecheck`. Restart Bunker → Admin panel → System → Plugins → enable → add it from server settings.
Because the code runs inside the Bunker process, this path is only for plugins written or reviewed by the Bunker team.

Files are TypeScript without a build step (Node 22 strips types). So don't use syntax that type stripping cannot
handle (`enum`, `namespace`, parameter properties like `constructor(private x)`), and write the `.ts`
extension in imports.

---

## Manifest: `bunker-plugin.json`

| Field | Required | Description |
|---|---|---|
| `id` | yes* | *Omitted for remote plugins (it's the token's plugin, `ext-xxxxxxxx`). Lowercase letters, digits, dashes; 2-28 characters, cannot start or end with a dash. **Must match the folder name.** Permanent identity: storage, settings and the bot identity depend on it; don't change it later. |
| `name` | yes | Display name, ≤40. Also the bot's name in messages (server admins can rename it on their server). |
| `version` | yes | `x.y.z` (optional suffix like `-beta.1`). |
| `sdk` | yes | Compatible SDK version: `"0.1"` (see [Versions](#versions-and-compatibility)). |
| `permissions` | yes | Array of permissions (may be empty). |
| `description` | no | ≤300. Shown in the Store and server settings. |
| `author` | no | ≤80. |
| `main` | no | Entry file, default `src/index.ts` (built-in plugins only). |
| `ui` | no | Panel window, see [Window](#window-panel-ui). |

An invalid manifest is not loaded; errors show in the admin panel. You can validate it yourself:

```ts
import { validateManifest } from "@bunker-community/plugin-sdk";
const r = validateManifest(JSON.parse(text)); // { ok: true, manifest } | { ok: false, errors: string[] }
```

---

## Permissions

A plugin can only do what the permissions in its manifest allow; calls without permission throw. The server owner
approves this list when adding the plugin. If an update **asks for a new permission**, the plugin stops working on
that server until it is approved again. Don't ask for permissions you don't need.

| Permission | Shown to the server owner | Unlocks |
|---|---|---|
| `events.messages` | Reads messages in text channels, replies to commands | `message.*` events, `ctx.command` |
| `events.voice` | Sees who joins and leaves voice channels | `voice.*` events |
| `events.members` | Sees members joining and leaving the server | `member.*`, `guild.create/delete` |
| `events.channels` | Sees channels being created, changed and deleted | `channel.*` |
| `events.presence` | Sees whether members are online | `user.online/offline` |
| `chat.send` | Posts messages in text channels under its own name | `ctx.chat.send`, `CommandCall.reply` |
| `storage` | Stores its own data on Bunker | `ctx.storage` |
| `voice.speak` | Joins voice channels and plays audio | `ctx.voice` |

`ctx.ui` (window) and `ctx.log` need no permission.

**Scope:** a plugin only hears events from **servers it is installed on**, and only writes / joins voice channels
there. Direct messages (DMs) are never sent to plugins.

---

## Lifecycle

```ts
export default definePlugin({
  async setup(ctx) {
    // Called once when the plugin starts. Set up listeners here.
    ctx.onUnload(async () => {
      // On shutdown: stop timers, save state to storage if needed.
    });
  },
});
```

- If `setup` throws, the plugin goes into the `error` state.
- When the plugin is stopped (admin panel, server restart, error budget exceeded): all listeners are released,
  voice sessions close, `onUnload` functions run. Storage still works inside `onUnload`. On server shutdown plugins
  get **at most 3 s** in total.
- After shutdown every call on the old `ctx` throws `"plugin kapalı"`; clean up anything you started yourself
  (`setTimeout` etc.) in `onUnload`.
- Built-in plugins: code changes need a server restart (module cache).
- **Error budget:** if your listeners throw 10 errors within 60 s, the plugin stops itself.

---

## `PluginContext` (ctx)

| Member | Description |
|---|---|
| `ctx.manifest` | Validated manifest (read-only). |
| `ctx.log.info/warn/error(msg, ctx?)` | Writes to Bunker's logs with the `plugin` tag. |
| `ctx.on(event, fn)` | Listen to an event; the returned function stops listening. |
| `ctx.command(name, fn)` | `!name` command. |
| `ctx.chat.send(channel, text)` | Message to a text channel. |
| `ctx.storage` | Persistent key-value storage. |
| `ctx.voice.join(cid)` / `ctx.voice.session(cid)` | Voice channel session. |
| `ctx.ui.setState(where, state, opts?)` / `ctx.ui.onAction(fn)` | Panel window. |
| `ctx.onUnload(fn)` | Cleanup on shutdown. |

All event data is a **copy** from the core; changing it does not affect Bunker.

---

## Events

```ts
ctx.on("member.join", (e) => ctx.log.info("new member", { gid: e.gid, uid: e.uid }));
```

| Event | Data | Permission |
|---|---|---|
| `message.create` | `{ scope: "text", gid, chan, m: PluginMessage }` | `events.messages` |
| `message.edit` | `{ scope, gid, chan, m }` | `events.messages` |
| `message.delete` | `{ scope, gid, chan, id, by }` | `events.messages` |
| `message.react` | `{ scope, gid, chan, id, uid, emoji, added }` | `events.messages` |
| `voice.join` | `{ gid, cid, uid, bot }` | `events.voice` |
| `voice.move` | `{ gid, cid, uid, bot, from }` | `events.voice` |
| `voice.leave` | `{ gid, cid, uid, bot }` | `events.voice` |
| `member.join` / `member.leave` | `{ gid, uid }` | `events.members` |
| `guild.create` | `{ gid, owner }` | `events.members` |
| `guild.delete` | `{ gid }` | `events.members` |
| `channel.create/update/delete` | `{ gid, kind: "text" \| "voice", id }` | `events.channels` |
| `user.online` / `user.offline` | `{ uid }` (only for members of a server you are installed on) | `events.presence` |
| `guild.install` | `{ gid, by }`: the plugin was added to this server | — |
| `guild.uninstall` | `{ gid }`: removed, or the server was deleted; **delete that server's data here** | — |

```ts
interface PluginMessage {
  id: string; ts: number; uid: string; nick: string;
  text: string;          // raw text: mentions as <@uid>, custom emoji as <:name:id>
  system: boolean;       // system line such as "... pinned a message"
  bot: boolean;          // written by a bot or plugin (including yours: avoid loops!)
  attachments: number;   // number of images/videos
  replyTo?: string; edited?: number;
}
```

Events arrive after the core has finished its work (deferred): a slow listener never blocks Bunker, and your reply
appears after the user's message.

---

## Commands

```ts
ctx.command("dice", async (c) => {
  const sides = Number(c.args) || 6;
  await c.reply(`${c.nick} rolled: ${1 + Math.floor(Math.random() * sides)}`);
});
```

- Permission: `events.messages` (plus `chat.send` to reply).
- Name: letters, digits, `_`, `-`; 1-32 characters; lowercased; written without `!`.
- Triggered only in text channels, only when a **human** writes it (bots cannot run commands).
- Bunker's own commands (`!play`, `!skip`, `!rank`, `!bug` …) and names taken by another plugin cannot be used
  (`setup` throws).

```ts
interface CommandCall {
  gid: string; chan: string; uid: string; nick: string;
  args: string;                 // text after the command
  m: PluginMessage;
  reply(text: string): Promise<void>; // to the same channel
}
```

---

## Sending messages

```ts
const r = await ctx.chat.send(chanId, "Hello!"); // { id } | null
```

- Permission `chat.send`. Only to text channels of servers you are installed on.
- Shown under the plugin's name (or the name given on that server) with a BOT tag.
- At most 10 messages per 10 s; more throws.
- Write mentions as `<@uid>`.

---

## Storage

```ts
await ctx.storage.set("config:" + gid, { lang: "en" });
const a = await ctx.storage.get<{ lang: string }>("config:" + gid); // undefined if missing
await ctx.storage.delete("config:" + gid);
const keys = await ctx.storage.keys("config:");
```

- Permission `storage`. Private to the plugin (other plugins can't see it), stored in Bunker's database, survives restarts.
- Values must be JSON-serializable, ≤64 KB. Keys 1-200 characters; ≤10,000 keys per plugin.
- One store **shared by all servers**: prefix per-server data with `gid` and delete it on `guild.uninstall`.

---

## Voice

Permission `voice.speak`. One session per voice channel (the bot shows up as a separate member in the channel).

```ts
const s = await ctx.voice.join(cid);   // same session if already there
s.setVolume(30);
s.on("started", () => ctx.log.info("playing"));
s.on("ended", () => ctx.log.info("finished"));
s.on("error", (why, { silent }) => { if (!silent) ctx.log.warn(why); });
s.on("leave", (why) => ctx.log.info("left: " + why));
await s.playMedia("daft punk one more time");
```

`ctx.voice.session(cid)` returns the open session (or `null`).

### `VoiceSession`

| Member | Description |
|---|---|
| `gid`, `cid` | Server and channel. |
| `playing`, `paused`, `volume` (0-100), `connected` | State (read-only). |
| `playMedia(query, { seek? })` | YouTube / SoundCloud link, radio stream or search text (searched on YouTube, SoundCloud if blocked). Track info arrives via the `meta` event. |
| `prefetch(query)` | Resolve the next track in advance (faster transitions; valid for 30 min). |
| `playUrl(url, { seek? })` | Direct http(s) audio URL (radio, mp3…). Internal network addresses are rejected. |
| `playPcm(stream)` | Your own audio: 48 kHz, stereo, 16-bit little-endian raw PCM, `AsyncIterable<Uint8Array>`. Built-in plugins only. |
| `stop()`, `pause()`, `resume()` | A new `play*` stops what is playing. |
| `setVolume(v)` | 0-100. |
| `leave()` | Leave the channel. |
| `on(event, fn)` → unsubscribe function | `started` (first audio sent), `ended` (stream finished), `error(why, { silent })` (could not play; `silent` = e.g. YouTube blocking, no need to show users), `meta(MediaMeta)`, `leave(why)`. |

```ts
interface MediaMeta { title: string; artist: string; duration: number /* s, 0 for live */; thumb: string; src: string; url: string }
```

- The session closes 60 s after no humans are left, immediately when the channel is deleted, and when the plugin
  is removed from the server or stopped (`leave` event).
- At most 12 plugin voice sessions across Bunker at once.

---

## Window (panel UI)

A plugin can show an icon in the plugin group at the bottom left of the panel, and a window that opens on click.

```json
"ui": { "title": "Music", "icon": "music", "page": "ui/index.html", "scope": "voice" }
```

| Field | Description |
|---|---|
| `title` | Window title (≤40). |
| `icon` | Panel icon name (below); default `plug`. |
| `page` | An `.html` file in the plugin folder. |
| `scope` | `"voice"`: only visible while in one of that server's voice channels, state **per channel**. `"guild"`: always visible on the server, state per server. |

Available icons: `dots copy ticket hash pin volume mic micOff headphones headphonesOff gear users lock plus chevron
x menu send clip moon sun plug radio store arrowIn arrowOut volumeX ban hand edit trash user info mute rec screen
camera moveTo logout shield compass userPlus check search door music shuffle skip play pause list smile smilePlus
reply message maximize gamepad monitor tv download sleep clock crown live phone phoneOff video bell at keyboard
palette key`.

### Model: state down, actions up

```
plugin (server)  ── ctx.ui.setState ──▶  panel  ── postMessage {bunker:"state"} ──▶  page (iframe)
plugin (server)  ◀── ctx.ui.onAction ──  panel  ◀── postMessage {bunker:"action"} ──  page
```

The page cannot connect anywhere by itself; all logic lives in the plugin, the page only renders state and forwards clicks.

**Plugin side**

```ts
ctx.ui.onAction(async (a) => {
  // a: { gid, cid?, uid, nick, name, data }
  if (a.name === "counter.inc") {
    const n = ((await ctx.storage.get<number>("n:" + a.gid)) ?? 0) + 1;
    await ctx.storage.set("n:" + a.gid, n);
    ctx.ui.setState({ gid: a.gid }, { n, last: a.nick });
  }
});
```

- `setState({ gid, cid? }, state, { live? })`: sent immediately to everyone on that server (in that channel for
  scope `voice`); users who connect later get the latest state too. JSON, ≤32 KB. `live: true` → the icon at the
  bottom left lights up (e.g. while playing). `null` → clear. State is kept in memory and lost on restart (save to
  storage if needed).
- `onAction`: Bunker checks first that the user is a member of the server and, for scope `voice`, is in that
  channel. ≤10 actions per second per user, `data` ≤4 KB. Still, treat `data` as **untrusted input** and validate it.
- When the page first opens and there is no state yet, `state: null` arrives; sending a `"hello"` action and
  publishing state in response is a good habit.

**Page side (`ui/index.html`)**

```html
<!doctype html>
<meta charset="utf-8">
<style>
  :root { --bg:#1e1f22; --text:#dbdee1; --accent:#6c6cff; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--text); font:14px system-ui; }
  button { background:var(--accent); color:#fff; border:0; border-radius:6px; padding:8px 12px; }
</style>
<p id="t">…</p>
<button id="b">Increment</button>
<script>
  const act = (name, data) => parent.postMessage({ bunker: "action", name, data }, "*");
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || m?.bunker !== "state") return;
    for (const [k, v] of Object.entries(m.ctx.theme)) if (typeof v === "string") document.documentElement.style.setProperty("--" + k, v);
    if (!m.state) return act("hello");
    document.getElementById("t").textContent = `Counter: ${m.state.n} (last: ${m.state.last})`;
  });
  document.getElementById("b").onclick = () => act("counter.inc");
  parent.postMessage({ bunker: "ready" }, "*");
</script>
```

Messages:

| Direction | Message |
|---|---|
| page → panel | `{ bunker: "ready" }` (ready, send state) · `{ bunker: "action", name, data? }` · `{ bunker: "close" }` (close the window) |
| panel → page | `{ bunker: "state", state, ctx: { gid, cid, me: { uid, nick }, theme: { dark, bg, text, muted, accent, border, hover } } }` |

Page rules:
- Opens inside `<iframe sandbox="allow-scripts">` on a separate origin: no access to the panel's cookies, data or DOM.
- CSP: no network requests (`fetch`, WebSocket, forms); scripts and styles inline or from the plugin folder, fonts
  from `data:` or the folder. Images may load from `https:`, `data:` or the folder (e.g. cover art). A **single
  file** is recommended (remote plugins: required).
- The page is served only from the folder of `ui.page` (`/plugin-ui/<id>/…`).
- The panel's translation is not applied to the page; `ctx` has no language yet, choose your own texts.
- Take colors from `ctx.theme` so the page fits light and dark themes.

---

## Running on Bunker (hosting)

If you can't keep your code running on an always-on machine, Bunker can run it. The code is the same; it is just
bundled into one file and reviewed by the Bunker team.

1. Bundle your code into **a single ESM file**. No imports other than `@bunker-community/plugin-sdk` may remain:

```bash
npx esbuild index.js --bundle --format=esm --platform=neutral --external:@bunker-community/plugin-sdk --outfile=bundle.mjs
```

   The file must contain `export default definePlugin({ … })` and must **not** call `connect()` (Bunker connects it).
   To run the same code both on your computer and on Bunker, put `connect` in a separate file:

```js
// plugin.js: the part uploaded to Bunker
import { definePlugin } from "@bunker-community/plugin-sdk";
export default definePlugin({ setup(ctx) { /* … */ } });

// local.js: only on your computer
import { connect } from "@bunker-community/plugin-sdk";
import plugin from "./plugin.js";
connect(plugin, { token: process.env.BUNKER_TOKEN });
```

2. **Settings → Developer** → **Upload code** on your plugin's row: select `bundle.mjs` + `bunker-plugin.json`
   (+ the `.html` page if it has a window) together. At most 1 MB.
3. The site admin reviews the code: you'll see **Approved** or **Rejected** (with a reason).
4. Once approved, click **Run on Bunker**. The row shows "Running on Bunker". Connecting from your own computer
   with the same token is now rejected (code 4004); after **Stop** you can connect from your computer again.
5. If you upload new code, **the previously approved version keeps running** until the new one is approved.

Rules for hosted code (restricted process):

| | |
|---|---|
| Network | None: `fetch`, `WebSocket`, `http`, `net`, `dns`… are blocked. The only connection is the Bunker API. |
| Files | Only its own file can be read; no writing. `fs`, `os`, `child_process`, `worker_threads`, `vm` are blocked. |
| Environment | Empty environment variables; Bunker's keys, database and files are not visible. |
| Memory | 128 MB (if exceeded, the process is killed and restarted). |
| CPU | Killed if the 1-minute average exceeds 60%, or if it doesn't respond for 20 s (infinite loop). |
| Crashes | Restarted (waiting 2 s → 60 s); after 5 crashes in 10 min it stops and the reason shows on the row. |
| Logs | `console.log` / `console.error` go to Bunker's logs (at most 60 lines per minute). |
| Storage | The same storage: what you saved while running on your computer is still there when hosted. |

A plugin that needs the network (e.g. a weather bot calling an external API) cannot be hosted; run it on your own machine.

---

## Limits

| What | Limit |
|---|---|
| Plugins per server | 25 |
| Error budget | 10 errors in 60 s → plugin stops |
| `chat.send` | 10 messages per 10 s |
| Storage value / number of keys / key length | 64 KB / 10,000 / 200 |
| Window state | 32 KB |
| Window action | 10 per second per user, `data` ≤4 KB |
| Voice sessions (Bunker-wide) | 12 |
| Command name | 1-32 characters |
| Remote plugins (per person) | 5 |
| Gateway | message ≤320 KB, ~30 calls per second |
| Hosted code | single file ≤1 MB, 128 MB memory, 60% CPU; 20 processes Bunker-wide |

---

## Versions and compatibility

- SDK version `SDK_VERSION` (currently `0.1.4`). The `sdk` field in the manifest:
  - During `0.x`, minor versions count as breaking: `"0.1"` → works with 0.1.x, not with 0.2.
  - After `1.0`: `"1"` or `"1.2"` → same major version, at least that minor version.
- Rule: fields are **added**, never removed or renamed. A breaking change bumps the major version.
- Changes: 0.1.0 events, commands, storage, messages · 0.1.1 `guild.install/uninstall` · 0.1.2 voice
  (`voice.speak`, `playPcm/playUrl`) + window (`ui`) · 0.1.3 `playMedia`, `prefetch`, `meta`, `error.silent` ·
  0.1.4 remote plugins (`connect`), hosting.

---

## Publishing and adding to servers

**Remote plugin:**
1. Create it under Settings → Developer (at most 5 per person) and run your code.
2. While unverified it can only be added to servers where **you** have server settings permission. In the Store
   only you see it (with an "Unverified" tag).
3. To make it public, contact the Bunker team: if the site admin reviews it and enables "Server owners can add it"
   in the admin panel, everyone sees it in the Store (verified).
4. The site admin can disable an abusive plugin; its connection then closes (code 4003).
5. "Delete": the plugin is removed from all servers and its storage is deleted.

**Built into Bunker (first party):**
1. The plugin is added to the repo as `plugins/<id>/`, reviewed, deployed, and Bunker is restarted.
2. **Site admin** (Admin panel → System → Plugins): enables it (loads it) and optionally turns on "Server owners
   can add it" (listed in the Store). New plugins start disabled and unlisted.
3. **Server owner / anyone with `server.manage`:** adds it from the Plugin Store or Server settings → Plugins and
   approves the permissions. The bot shows in the "Bots" group of the member list and can be renamed per server.
4. Logs: Admin panel → Logs, tag `plugin`.

Local testing tips: `PLUGINS_DIR` for another plugin folder, `PLUGIN_VOICE_WORKER` for a fake voice process,
`PLUGIN_MEDIA_FAKE=<s>` for fake media (no yt-dlp or LiveKit needed).

---

## Gateway protocol (connecting without the SDK)

The SDK is for Node.js. To write a bot in another language, connect to the gateway directly: JSON text messages
over WebSocket `wss://bunker.community/app/api/plugin/gateway`. Messages ≤320 KB, ~30 calls per second (bursts up to 60).

**1. Hello** (first message, within 10 s):
```json
{ "op": "hello", "token": "ext-…", "sdk": "0.1.4", "manifest": { "…": "…" }, "uiPage": "<!doctype html>…" }
```
`manifest` and `uiPage` are optional. Reply:
```json
{ "op": "ready", "v": 1, "sdk": "0.1.4", "manifest": { "…": "…" }, "guilds": [{ "gid": "…", "name": "…" }] }
```

**2. Call → result:**
```json
{ "op": "call", "id": 7, "method": "chat.send", "args": ["<channel>", "hello"] }
{ "op": "result", "id": 7, "ok": true, "value": { "id": "<message>" } }
{ "op": "result", "id": 7, "ok": false, "error": "Bu kanala yazamazsın (plugin bu sunucuya ekli değil)." }
```

| method | args | value |
|---|---|---|
| `subscribe` / `unsubscribe` | `[event]` (event names + `"ui.action"`) | — |
| `command` / `uncommand` | `[name]` | — |
| `chat.send` | `[channel, text]` | `{ id }` or `null` |
| `storage.get` | `[key]` | value or `null` |
| `storage.set` | `[key, value]` | — |
| `storage.delete` | `[key]` | — |
| `storage.keys` | `[prefix]` | `string[]` |
| `ui.setState` | `[{ gid, cid? }, state, { live? }]` | — |
| `voice.join` / `voice.session` | `[cid]` | session state (session: `null` if none) |
| `voice.call` | `[cid, action, args[]]`; action: `playUrl playMedia prefetch stop pause resume setVolume leave` | session state |
| `log` | `["info" / "warn" / "error", message, extra?]` | — |
| `guilds` | `[]` | `[{ gid, name }]` |
| `ping` | `[]` | `"pong"` |

Session state: `{ gid, cid, playing, paused, volume, connected }`. Error messages are currently in Turkish.

**3. From the server:**
```json
{ "op": "event", "name": "member.join", "data": { "gid": "…", "uid": "…" } }
{ "op": "event", "name": "ui.action", "data": { "gid": "…", "cid": "…", "uid": "…", "nick": "…", "name": "…", "data": null } }
{ "op": "command", "name": "dice", "call": { "gid": "…", "chan": "…", "uid": "…", "nick": "…", "args": "20", "m": { "…": "…" } } }
{ "op": "voice", "cid": "…", "ev": "started", "args": [], "state": { "…": "…" } }
```
`voice.ev`: `started`, `ended`, `error`, `meta`, `leave`. To reply to a command, `chat.send` to `call.chan`.

**Close codes:** 4001 invalid / regenerated token · 4002 malformed message · 4003 plugin disabled or deleted ·
4004 a new connection with the same token was opened (or the plugin is hosted on Bunker) · 4005 invalid manifest
(reason in `reason`) · 4008 too fast or not reading messages. Reconnect on any other close. Subscriptions and
commands are dropped when the connection closes; send them again after reconnecting.

---

## Examples

- [`plugins/hello`](https://github.com/bunker-community/plugin-sdk/tree/main/examples/hello): command, event, storage, message.
- [`plugins/radio`](https://github.com/bunker-community/plugin-sdk/tree/main/examples/radio): voice (`playUrl`) + window.
- [`plugins/music`](https://github.com/bunker-community/plugin-sdk/tree/main/examples/music): per-channel queue, `playMedia` + `prefetch`, window, resuming after a
  restart (`onUnload` + storage).
