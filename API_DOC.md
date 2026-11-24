# Bunker Plugin Developer Guide and API Reference

SDK `@bunker-community/plugin-sdk` 0.1.9

This document is for people who want to write plugins (bots) for Bunker: what is required, how to upload, and which
functions are available.

## Contents
1. [What a plugin is and how it runs](#what-a-plugin-is-and-how-it-runs)
2. [Requirements](#requirements)
3. [Your first plugin: write, upload, run](#your-first-plugin-write-upload-run)
4. [Testing while developing: connecting from your computer](#testing-while-developing-connecting-from-your-computer)
5. [Lifecycle](#lifecycle)
6. [API reference](#api-reference)
7. [Publishing to the Store](#publishing-to-the-store)
8. [Limits and error messages](#limits-and-error-messages)
9. [FAQ](#faq)
10. [Appendix A: Gateway protocol (other languages)](#appendix-a-gateway-protocol-other-languages)
11. [Appendix B: Versions](#appendix-b-versions)

---

## What a plugin is and how it runs

A plugin is a small program added to Bunker servers: it replies to commands, listens to events (messages, voice
channels, members), stores data, plays music/radio in voice channels and shows its own window in the panel.

```
  you ── upload code ──▶  Bunker (restricted environment)  ──▶  servers you added the plugin to
                                   │
                                   └─ only what the SDK offers (the permissions you were granted)
```

- The code runs **on Bunker**, in a separate restricted environment per plugin. It has no internet or file access;
  its only connection to the outside is the SDK.
- A plugin runs **only on servers it was added to** and only sees those servers' events. It never sees direct
  messages (DMs).
- The server owner sees the requested **permissions** and approves them when adding the plugin.
- A new plugin is **unverified**: it can only be added to servers you manage, and it runs as soon as you upload it.
  To make it public, have the Bunker team review it ([Publishing to the Store](#publishing-to-the-store)).

---

## Requirements

A plugin that doesn't follow these rules is rejected or won't run.

### Files

| File | Required | Description |
|---|---|---|
| `bunker-plugin.json` | yes | Manifest: name, version, permissions (below). |
| Code file (`.mjs` / `.js`) | yes | **A single file**, ES module, ≤1 MB. |
| Window page (`.html`) | only if the manifest has `ui` | Single file; inline scripts and styles. |

### Manifest: `bunker-plugin.json`

```json
{
  "name": "Dice Bot",
  "version": "1.0.0",
  "description": "Rolls dice: !roll 20",
  "sdk": "0.1",
  "permissions": ["events.messages", "chat.send"]
}
```

| Field | Required | Rule |
|---|---|---|
| `name` | yes | Display name, at most 40 characters. The bot's name in messages (server admins can rename it on their server). |
| `version` | yes | `x.y.z` (e.g. `1.0.0`, `1.2.0-beta.1`). |
| `sdk` | yes | `"0.1"`. |
| `permissions` | yes | List of permissions; `[]` if you need none. |
| `description` | no | At most 300 characters; shown on Store cards and in server settings. |
| `details` | no | Long description, at most 4000 characters of plain text (a blank line starts a new paragraph). Shown when someone opens your plugin in the Store: what it does, how to use it, its commands. |
| `author` | no | At most 80 characters. |
| `ui` | no | Panel window ([Window](#window-ctxui)). |
| `network` | no | Hosts `ctx.http.fetch` may reach: `["api.example.com", "*.example.org"]`, at most 16 (needs `net.fetch`). Shown to the server owner. |
| `settings` | no | Per-server settings the server owner fills in ([Settings](#settings-ctxsettings)). |
| `id` | — | Don't set it: the plugin id (`ext-xxxxxxxx`) is assigned when you create the plugin on Bunker. |

### Code

- **A single file.** You can't import other files; bundle the libraries you use into one file
  ([First plugin](#your-first-plugin-write-upload-run), step 2).
- The file must `export default definePlugin({ setup(ctx) { … } })`.
- The only external import: `@bunker-community/plugin-sdk`.
- **Don't** call `connect()`; Bunker connects the plugin (connect is only for [testing on your computer](#testing-while-developing-connecting-from-your-computer)).

### What the environment forbids

| Forbidden | Description |
|---|---|
| Internet | No `fetch`, `WebSocket`, `http`, `https`, `net`, `dns`… You can't call external APIs. |
| File system | No `fs`, `os`, `child_process`, `worker_threads`, `vm`. Use [Storage](#storage-ctxstorage) for persistent data. |
| Environment variables | Empty. There is nowhere to put secret keys (and no internet to use them anyway). |
| Resources | 128 MB memory; if the 1-minute CPU average exceeds 40% or it doesn't respond for 20 s (infinite loop), the plugin is killed and restarted. After 5 crashes in 10 minutes it stops. |

A plugin that needs the internet (weather, exchange rates…) can currently only run [on your own computer](#testing-while-developing-connecting-from-your-computer).

### Permissions

Ask only for what you need; server owners won't add plugins that ask for too much, and the Store review rejects them.
An action without permission throws.

| Permission | Shown to the server owner | Unlocks |
|---|---|---|
| `events.messages` | Reads messages in text channels, replies to commands | `message.*` events, `ctx.command` |
| `chat.send` | Posts messages in text channels under its own name | `ctx.chat.send`, `c.reply` |
| `storage` | Stores its own data on Bunker | `ctx.storage` |
| `voice.speak` | Joins voice channels and plays audio | `ctx.voice` |
| `events.voice` | Sees who joins and leaves voice channels | `voice.*` events |
| `events.members` | Sees members joining and leaving the server | `member.*`, `guild.create/delete` |
| `events.channels` | Sees channels being created, changed and deleted | `channel.*` |
| `events.presence` | Sees whether members are online | `user.online/offline` |
| `ui.embed` | Shows content from other websites in its window (like video players) | manifest `ui.embed` |
| `guild.read` | Sees the server's channels, roles and member list | `ctx.guild` |
| `net.fetch` | Connects to outside services on the internet (only the addresses it lists) | `ctx.http.fetch` (manifest `network`) |
| `webhooks` | Receives notifications from outside services (webhooks) | `ctx.webhooks` |

`ctx.log`, `ctx.ui` and the `guild.install/uninstall` events need no permission. If an update **adds a new
permission**, the plugin stops on every server it is installed on until that server's owner approves it again.

---

## Your first plugin: write, upload, run

**1. Write two files.**

`bunker-plugin.json`
```json
{
  "name": "Dice Bot",
  "version": "1.0.0",
  "description": "Rolls dice: !roll 20",
  "sdk": "0.1",
  "permissions": ["events.messages", "chat.send"]
}
```

`plugin.js`
```js
import { definePlugin } from "@bunker-community/plugin-sdk";

export default definePlugin({
  setup(ctx) {
    ctx.command("roll", async (c) => {
      const sides = Math.max(2, Math.min(1000, Number(c.args) || 6));
      await c.reply(`${c.nick} rolled ${1 + Math.floor(Math.random() * sides)} (d${sides})`);
    });
  },
});
```

**2. Bundle into one file.** If you use no libraries, `plugin.js` already is a single file; skip this step.
Otherwise (Node.js 22+):

```bash
npm install @bunker-community/plugin-sdk
npx esbuild plugin.js --bundle --format=esm --platform=neutral --external:@bunker-community/plugin-sdk --outfile=bundle.mjs
```

**3. Create it on Bunker and upload.**
1. **Settings → Developer → New plugin**: type a name, **Create**. (Keep the token shown; you only need it for
   testing from your computer.)
2. On the plugin's row, **Upload code**: select the code file and `bunker-plugin.json` (plus the `.html` if it has
   a window) together.
3. **Run on Bunker**. The row shows "Connected (running on Bunker)".

**4. Add it to your server.** On your server: **Server settings → Plugins** (or the Plugin Store) → **Add** →
approve the permissions. Type `!roll 20` in a channel.

When you change the code, bundle again and **Upload new code**: the new code takes effect immediately.

---

## Testing while developing: connecting from your computer

Instead of uploading after every change, you can run the code on your computer and connect it to Bunker. The plugin
works on the same servers with the same permissions; only the code runs on your machine (and can use the internet).

```bash
npm install @bunker-community/plugin-sdk
```

`local.js` (with `"type": "module"` in `package.json`)
```js
import { connect } from "@bunker-community/plugin-sdk";
import plugin from "./plugin.js";

connect(plugin, { token: process.env.BUNKER_TOKEN });
```

```bash
BUNKER_TOKEN=<token> node local.js
# PowerShell: $env:BUNKER_TOKEN="<token>"; node local.js
```

- The token is shown **once** when you create the plugin under Settings → Developer; if you lose it, use
  **Regenerate token**. Don't put it in code or share it.
- `connect` sends `bunker-plugin.json` and the window page from the folder to Bunker on every connect.
- While the plugin runs on Bunker you can't connect from your computer (code 4004); click **Stop** on its row first.
- While your code isn't running, the bot shows offline and commands get no reply.

### `connect(plugin, options)`

| Option | Description |
|---|---|
| `token` | Required. The plugin's token. |
| `url` | Gateway address; default `wss://bunker.community/app/api/plugin/gateway`. |
| `manifest` | Manifest object; if omitted, `bunker-plugin.json` in `dir` is read. |
| `dir` | Folder of `bunker-plugin.json` and the window page (default: working directory). |
| `uiPage` | HTML of the window page (if omitted, the `ui.page` file is read). |
| `logger` | Connection logs (default `console`). |

Returns `{ ready: Promise<void>, connected: boolean, close(): Promise<void> }`. Reconnects by itself if the connection
drops (1 s → 30 s). Does not retry, and `ready` rejects, if the token is invalid, the plugin was disabled, the manifest
is invalid or the plugin is running on Bunker. This way you can't send raw PCM to voice channels (no `playPcm`);
`playMedia` and `playUrl` work.

---

## Lifecycle

```js
export default definePlugin({
  async setup(ctx) {
    // Runs once when the plugin starts: set up commands and listeners here.
    ctx.onUnload(async () => {
      // On shutdown: stop timers, save state to storage if needed.
    });
  },
});
```

- If `setup` throws, the plugin doesn't start (the reason shows under Settings → Developer).
- When the plugin stops (stop, new code, Bunker restart): listeners are released, voice sessions close, `onUnload`
  runs. Storage still works inside `onUnload`; at most 3 s in total.
- **Error budget:** if your listeners throw 10 errors within 60 s, the plugin stops itself. Catch your errors.
- After the plugin stops, every call on the old `ctx` throws `plugin is off`.

---

## API reference

### `definePlugin(definition)`

```ts
definePlugin({ setup(ctx: PluginContext): void | Promise<void> }): PluginDefinition
```
Returns the definition as is (a typing helper). This is the code file's `export default`.

### `PluginContext` (ctx)

| Member | Permission | Description |
|---|---|---|
| `ctx.manifest` | — | Validated manifest (read-only). |
| `ctx.log.info/warn/error(message, extra?)` | — | Logging (the error line under Settings → Developer and Bunker's logs). |
| `ctx.on(event, fn)` | per event | Listen to an event; the returned function stops listening. |
| `ctx.command(name, fn, opts?)` | `events.messages` | `!name` command; the returned function removes it. `opts`: description for the command list. |
| `ctx.chat.send(channel, text, opts?)` | `chat.send` | Message to a text channel; `opts.buttons`: buttons under it. |
| `ctx.chat.onButton(fn)` | `chat.send` | A button under one of your messages was clicked. |
| `ctx.guild.*` | `guild.read` | Server details, channels, roles, members. |
| `ctx.http.fetch(url, req?)` | `net.fetch` | Request to an outside service. |
| `ctx.webhooks.*` | `webhooks` | Incoming webhook addresses. |
| `ctx.settings.get(gid)` | — (manifest `settings`) | The server's settings for your plugin. |
| `ctx.storage` | `storage` | Persistent key-value storage. |
| `ctx.serverLang(gid)` | — | The server's language, `Promise<"en" \| "tr">` (Server settings → Language). |
| `ctx.voice.join(cid)` / `ctx.voice.session(cid)` | `voice.speak` | Voice channel session. |
| `ctx.voice.channelOf(uid)` | `voice.speak` or `events.voice` | Which voice channel a user is in: `Promise<{ gid, cid } \| null>` (null if not in a voice channel of a server you were added to). |
| `ctx.voice.members(cid)` | `voice.speak` or `events.voice` | Who is in a voice channel: `Promise<{ uid, nick, bot }[]>` (`[]` for a channel of a server you weren't added to). |
| `ctx.ui.setState(...)` / `ctx.ui.onAction(fn)` / `ctx.ui.send(...)` | — (manifest `ui`) | Panel window. |
| `ctx.onUnload(fn)` | — | Cleanup on shutdown. |

Event data is a copy; changing it doesn't affect Bunker.

### Events: `ctx.on(event, fn)`

```js
ctx.on("member.join", (e) => ctx.log.info("new member", { gid: e.gid, uid: e.uid }));
```

| Event | Data | Permission |
|---|---|---|
| `message.create` | `{ scope: "text", gid, chan, m: PluginMessage }` | `events.messages` |
| `message.edit` | `{ scope, gid, chan, m }` | `events.messages` |
| `message.delete` | `{ scope, gid, chan, id, by }` | `events.messages` |
| `message.react` | `{ scope, gid, chan, id, uid, emoji, added }` | `events.messages` |
| `voice.join` / `voice.leave` | `{ gid, cid, uid, bot }` | `events.voice` |
| `voice.move` | `{ gid, cid, uid, bot, from }` | `events.voice` |
| `member.join` / `member.leave` | `{ gid, uid }` | `events.members` |
| `guild.create` / `guild.delete` | `{ gid, owner }` / `{ gid }` | `events.members` |
| `channel.create/update/delete` | `{ gid, kind: "text" \| "voice", id }` | `events.channels` |
| `user.online` / `user.offline` | `{ uid }` (if a member of a server you were added to) | `events.presence` |
| `guild.install` | `{ gid, by }`: the plugin was added to this server | — |
| `guild.uninstall` | `{ gid }`: removed, or the server was deleted; **delete that server's data here** | — |
| `settings.change` | `{ gid, values }`: the server owner saved your settings (all values, defaults filled in) | — |

```ts
interface PluginMessage {
  id: string; ts: number; uid: string; nick: string;
  text: string;         // raw text: mentions <@uid>, custom emoji <:name:id>
  system: boolean;      // system line such as "… pinned a message"
  bot: boolean;         // written by a bot/plugin (including yours: avoid reply loops)
  attachments: number;  // number of images/videos
  replyTo?: string; edited?: number;
}
```

Events arrive after Bunker has finished its work; a slow listener never blocks Bunker.

### Commands: `ctx.command(name, fn)`

```js
ctx.command("hello", (c) => c.reply(`Hello ${c.nick}!`));
```

- Name: letters, digits, `_`, `-`; 1-32 characters; written without `!`; lowercased.
- Triggered only in text channels and only when a **human** writes it.
- Bunker's own commands (`!play`, `!skip`, `!rank`, `!bug`…) and names taken by another plugin can't be used.
- `opts` (optional): `{ description?, usage?, tr?: { description?, usage? } }`. While someone types `!` in a channel the
  panel lists your commands with this description (Turkish from `tr` for Turkish users). Commands without a
  description only show once the person starts typing their name, so give aliases no description.

```js
ctx.command("weather", handler, { description: "Today's weather", usage: "<city>", tr: { description: "Bugünün hava durumu", usage: "<şehir>" } });
```

```ts
interface CommandCall {
  gid: string; chan: string; uid: string; nick: string;
  args: string;                       // text after the command
  m: PluginMessage;
  manage: boolean;                    // the writer has server settings permission on this server
  lang: "en" | "tr";                  // the server's language: write your reply in it
  reply(text: string, opts?: { ephemeral?: boolean; buttons?: MessageButton[] }): Promise<void>; // to the same channel (needs chat.send)
}
```

`reply(text, { ephemeral: true })`: only the person who wrote the command sees the reply ("Only you can see this").
It isn't stored and disappears when they reload: good for help texts, errors and private results. Ephemeral replies
can only carry link buttons.

### Messages: `ctx.chat.send(channel, text)`

```js
const r = await ctx.chat.send(chanId, "Hello!"); // { id } | null
```
Only to text channels of servers you were added to; shown under the bot's name with a BOT tag. At most 10 messages
per 10 s per server. Text at most 1024 characters (longer is cut). Mentions: `<@uid>`.

**Buttons.** Put up to 10 buttons under a message; a click reaches your `ctx.chat.onButton` handler:

```js
await ctx.chat.send(chan, "Pizza tonight? (0 votes)", { buttons: [
  { id: "yes", label: "Yes", style: "success" },
  { id: "no", label: "No", style: "danger" },
  { url: "https://example.com/menu", label: "Menu" },     // link button: opens the address, doesn't reach you
] });

const votes = new Map();
ctx.chat.onButton(async (b) => {
  votes.set(b.uid, b.id);
  const yes = [...votes.values()].filter((v) => v === "yes").length;
  await b.update({ text: `Pizza tonight? (${yes} yes, ${votes.size - yes} no)` });
  await b.reply(b.userLang === "tr" ? "Oyun kaydedildi" : "Vote saved", { ephemeral: true });
});
```

| Button field | Rule |
|---|---|
| `id` | 1-40 characters (letters, digits, `_ . : -`), unique in the message. What `b.id` is on click. |
| `label` | 1-40 characters. |
| `style` | `"primary"`, `"secondary"` (default), `"success"`, `"danger"`. |
| `disabled` | `true`: shown but can't be clicked. |
| `url` | Instead of `id`: an `https` link button. |

```ts
interface ButtonClick {
  gid: string; chan: string; msgId: string;   // the message the button is under
  id: string;                                  // the button's id
  uid: string; nick: string; manage: boolean;
  lang: "en" | "tr";                           // the server's language (messages to the channel)
  userLang: "en" | "tr";                       // the clicker's panel language (ephemeral replies)
  reply(text: string, opts?: { ephemeral?: boolean; buttons?: MessageButton[] }): Promise<void>;
  update(p: { text?: string; buttons?: MessageButton[] }): Promise<void>; // change this message; buttons: [] removes them
}
```

`update` only changes the message whose button was clicked, within 15 minutes of the click; the message doesn't get an
"edited" mark. Bunker checks the person is a member of the server and limits clicks to 10 per 10 s per person.
Keep your counts in `ctx.storage` if they must survive a restart.

### Server details: `ctx.guild`

Needs `guild.read`; only servers you were added to (otherwise `null` / `[]`).

| Function | Returns |
|---|---|
| `info(gid)` | `{ id, name, owner, members, lang, created }` or `null` |
| `channels(gid)` | `[{ id, kind: "text" \| "voice", name, parent? }]` |
| `roles(gid)` | `[{ id, name, color, position, admin }]` |
| `members(gid)` | `[{ uid, nick, roles: [roleId], online, bot, joined? }]` (at most 5000) |
| `member(gid, uid)` | one member or `null` |

```js
const m = await ctx.guild.member(c.gid, c.uid);
const roles = await ctx.guild.roles(c.gid);
await c.reply(`${m.nick}: ${m.roles.map((id) => roles.find((r) => r.id === id)?.name).join(", ") || "no roles"}`, { ephemeral: true });
```

### Outside requests: `ctx.http`

Needs `net.fetch` and the hosts in the manifest's `network` (`"api.example.com"` or `"*.example.com"`; the server owner
sees them when adding the plugin). Plugins hosted on Bunker can't use `fetch`; this is their way out.

```js
const r = await ctx.http.fetch("https://api.example.com/v1/weather?city=Izmir", { headers: { authorization: "Bearer …" } });
if (r.ok) await c.reply(`${r.json().temp} °C`);
```

| `req` field | Rule |
|---|---|
| `method` | `GET` (default), `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD` |
| `headers` | object of strings (`cookie`, `host` and connection headers are dropped) |
| `body` | text, ≤256 KB (`JSON.stringify` yourself and set `content-type`) |
| `timeout` | ms, 1000-15000 (default 10000) |

Returns `{ status, ok, headers, body, json() }` (body as text, ≤2 MB). Only `https`, host names (no IP addresses);
addresses that resolve to private networks are refused; redirects are not followed (you get the 3xx and its
`location`). 60 requests per minute.

### Webhooks: `ctx.webhooks`

Needs `webhooks`. An address per server that outside services (GitHub, CI, stores…) post to. The address is shown
only when it is created, so give it to the server admin right away (an ephemeral reply is ideal):

```js
ctx.command("github", async (c) => {
  if (!c.manage) return c.reply("Only server admins can do this.", { ephemeral: true });
  const h = await ctx.webhooks.create(c.gid, "GitHub");
  await ctx.storage.set(`hook:${h.id}`, { chan: c.chan });
  await c.reply(`Add this as a webhook in your GitHub repository: ${h.url}`, { ephemeral: true });
});

ctx.webhooks.onRequest(async (r) => {
  const where = await ctx.storage.get(`hook:${r.hookId}`);
  const e = JSON.parse(r.body);
  if (where && r.headers["x-github-event"] === "push") await ctx.chat.send(where.chan, `New push to ${e.repository.full_name}`);
});
```

| Function | Description |
|---|---|
| `create(gid, name)` | `{ id, gid, name, created, url }`; at most 10 per server. |
| `list(gid)` | `[{ id, gid, name, created }]` (no address: it can't be shown again). |
| `delete(id)` | The address stops working. |
| `onRequest(fn)` | `fn({ hookId, gid, name, method, headers, query, body })` |

The sender gets `202 Accepted` right away (it can't receive your answer). `GET`, `POST`, `PUT`, `PATCH`; body ≤256 KB as
raw text (verify signatures such as GitHub's `x-hub-signature-256` over it); 30 calls per minute per address. When the
plugin is removed from a server its addresses there stop working.

### Settings: `ctx.settings`

Declare settings in the manifest; the server owner fills them in under Server settings → Plugins → **Settings**.
Bunker validates the values (a channel must be a channel of that server, a number within `min`/`max`…).

```json
"settings": [
  { "key": "channel", "type": "channel", "label": "Announcement channel", "tr": { "label": "Duyuru kanalı" } },
  { "key": "prefix", "type": "text", "label": "Greeting", "default": "Hello", "maxLength": 50 },
  { "key": "level", "type": "select", "label": "Level", "options": [{ "value": "low", "label": "Low" }, { "value": "high", "label": "High" }] },
  { "key": "pings", "type": "boolean", "label": "Mention people", "default": false },
  { "key": "limit", "type": "number", "label": "Daily limit", "min": 1, "max": 100, "default": 10 }
]
```

| Field | Rule |
|---|---|
| `key` | letters, digits, `_` (1-32), unique |
| `type` | `text`, `number`, `boolean`, `select`, `channel` (`voice: true` for a voice channel), `role` |
| `label` / `description` | English (≤60 / ≤200); `tr: { label, description, options: { value: "Türkçe" } }` for Turkish |
| `default` | of the field's type; otherwise empty / `false` / `min` / the first option |
| `options` | `select` only: `[{ value, label }]` |
| `min` / `max` / `maxLength` | `number` / `text` |

```js
const s = await ctx.settings.get(gid);   // { channel: "…", prefix: "Hello", level: "low", pings: false, limit: 10 }
ctx.on("settings.change", ({ gid, values }) => { /* saved */ });
```

At most 20 fields. Settings are deleted when the plugin is removed from the server. Store your own data in `ctx.storage`.

### Storage: `ctx.storage`

```js
await ctx.storage.set("config:" + gid, { lang: "en" });
const a = await ctx.storage.get("config:" + gid);   // undefined if missing
await ctx.storage.delete("config:" + gid);
const keys = await ctx.storage.keys("config:");
```

| Function | Returns |
|---|---|
| `get(key)` | value or `undefined` |
| `set(key, value)` | — (value must be JSON-serializable) |
| `delete(key)` | — |
| `keys(prefix?)` | `string[]` |

Private to the plugin, persistent. Values ≤64 KB, keys 1-200 characters, at most 10,000 keys. **One store** for all
servers: prefix per-server data with `gid` and delete it on `guild.uninstall`.

### Voice: `ctx.voice`

```js
const s = await ctx.voice.join(cid);     // same session if already there
s.setVolume(30);
s.on("meta", (m) => ctx.log.info("playing: " + m.title));
s.on("error", (why, { silent }) => { if (!silent) ctx.log.warn(why); });
await s.playMedia("daft punk one more time");
```

`ctx.voice.session(cid)` returns the open session (or `null`). The bot shows up as a separate member in the channel.

| `VoiceSession` | Description |
|---|---|
| `gid`, `cid`, `playing`, `paused`, `volume` (0-100), `connected` | State (read-only). |
| `playMedia(query, { seek? })` | YouTube / SoundCloud link, radio stream or search text. Track info arrives via the `meta` event. |
| `prefetch(query)` | Prepare the next track (faster transitions; valid for 30 min). |
| `playUrl(url, { seek? })` | Direct http(s) audio URL (radio, mp3). |
| `stop()`, `pause()`, `resume()`, `setVolume(v)` | Controls. |
| `leave()` | Leave the channel. |
| `on(event, fn)` | `started`, `ended`, `error(why, { silent })`, `meta(MediaMeta)`, `leave(why)`; the returned function unsubscribes. |

```ts
interface MediaMeta { title: string; artist: string; duration: number /* s, 0 for live */; thumb: string; src: string; url: string }
```
If `error` has `silent: true` (e.g. YouTube blocking), you don't need to show it to users. The session closes 60 s
after nobody is left in the channel, and immediately when the channel is deleted (`leave`). At most 12 plugin voice
sessions across Bunker at once.

### Window: `ctx.ui`

A plugin can show an icon in the plugin group at the bottom left of the panel, and a window that opens on click.

```json
"ui": { "title": "Dice", "icon": "gamepad", "page": "ui.html", "scope": "guild" }
```

| Field | Description |
|---|---|
| `title` | Window title (≤40). |
| `icon` | Icon name (below); default `plug`. |
| `page` | The window page `.html` (select it too when uploading). |
| `scope` | `"guild"`: always visible on the server, state per server. `"voice"`: only while in one of that server's voice channels, state **per channel**. |
| `layout` | `"window"` (default): a window over the panel. `"stage"`: the page fills the big area where the chat is, like a video call or a screen share (players, games). The user hides it with the icon or when the page sends `{ bunker: "close" }`. |
| `embed` | Other websites your page may embed (frames and their scripts), as https origins: `["https://www.youtube.com", "https://*.vimeo.com"]`, at most 16. Needs the `ui.embed` permission. |

Icons: `music radio tv gamepad play pause skip shuffle list volume mic headphones monitor screen camera video live
clock bell crown smile message hash pin users user gear plug store compass shield key palette keyboard search check
info edit trash download sleep phone at`.

**Model: state down, actions up.** The page cannot connect anywhere by itself; all logic lives in the plugin.

```
plugin ── ctx.ui.setState ──▶ panel ── {bunker:"state"} ──▶ page
plugin ◀── ctx.ui.onAction ── panel ◀── {bunker:"action"} ── page
```

| Function | Description |
|---|---|
| `ctx.ui.setState({ gid, cid? }, state, { live?, label?, open? })` | Sends the state to everyone on that server (in that channel for scope `voice`); people opening it later get the latest state too. JSON, ≤32 KB. `live: true` → the icon lights up; for scope `voice` your icon also shows next to the channel in the channel list, with `label` (≤100 characters, e.g. the song or video title) as its tooltip. `open: true` → opens the window for the people it applies to right now (e.g. when a video starts; at most once per 10 s per channel). `null` → clear (an open stage closes). Kept in memory. |
| `ctx.ui.onAction(fn)` | `fn({ gid, cid?, uid, nick, name, data, manage, lang })` (`manage`: the user has server settings permission; `lang`: their panel language). Bunker checks the user is a member (and in the channel for scope `voice`); ≤10 per second per user, `data` ≤4 KB. Still validate `data`. |

```js
ctx.ui.onAction(async (a) => {
  if (a.name === "roll") ctx.ui.setState({ gid: a.gid }, { last: a.nick, result: 1 + Math.floor(Math.random() * 6) });
});
```

Page (`ui.html`):
```html
<!doctype html>
<meta charset="utf-8">
<style>
  :root { --bg:#1e1f22; --text:#dbdee1; --accent:#6c6cff; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--text); font:14px system-ui; }
  button { background:var(--accent); color:#fff; border:0; border-radius:6px; padding:8px 12px; }
</style>
<p id="t">…</p>
<button id="b">Roll</button>
<script>
  const act = (name, data) => parent.postMessage({ bunker: "action", name, data }, "*");
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || m?.bunker !== "state") return;
    for (const [k, v] of Object.entries(m.ctx.theme)) if (typeof v === "string") document.documentElement.style.setProperty("--" + k, v);
    document.getElementById("t").textContent = m.state ? `${m.state.last}: ${m.state.result}` : "No rolls yet";
  });
  document.getElementById("b").onclick = () => act("roll");
  parent.postMessage({ bunker: "ready" }, "*");
</script>
```

| Direction | Message |
|---|---|
| page → panel | `{ bunker: "ready" }` · `{ bunker: "action", name, data? }` · `{ bunker: "close" }` |
| panel → page | `{ bunker: "state", state, ctx: { gid, cid, me: { uid, nick }, manage, age, lang, stage, theme: { dark, bg, text, muted, accent, border, hover } } }` |

Plus `{ bunker: "message", data }`: data sent only to this user with `ctx.ui.send(uid, { gid, cid? }, data)` (e.g. the
result of an action, or an error). `ctx.manage`: whether the viewer has server settings permission (for showing
buttons only; check `UiAction.manage` in the plugin).

`ctx.lang`: the viewer's panel language (`"en"` or `"tr"`). The panel doesn't translate your page; pick your texts by it.

`ctx.age`: how many ms ago the plugin produced this state. The same state may be sent again (e.g. when the window is
reopened), so a page that shows elapsed time (a progress bar) should add `age` instead of assuming the state is fresh.

Page rules: opens in an isolated frame served from a separate address for plugin content (no access to the panel's
cookies or data); no network requests (`fetch`, WebSocket); a single file with inline scripts and styles; images and
`<video>`/`<audio>` may be `https:`, `data:` or `blob:` (a file the user picks); frames and scripts only from the
origins in `ui.embed`; take colors from `ctx.theme`. `localStorage` works but is shared by all plugin pages: prefix
your keys with your plugin's name. Full screen works (`document.documentElement.requestFullscreen()`). **Forms don't submit**
in the isolated frame (the `submit` event never fires): don't rely on `<form onsubmit>`; handle the button's `click` and
the input's `keydown` (Enter) yourself.

---

## Publishing to the Store

An unverified plugin only runs on your servers and only you see it in the Store (with an "Unverified" tag). To let
everyone add it:

1. Make sure it works well on your own server.
2. Contact the Bunker team (support@bunker.community) with the plugin's name and id (`ext-…`).
3. The team reviews the code. If approved, it becomes visible to everyone in the Store (verified).

The review checks: whether the requested permissions are really needed, whether the description is accurate, whether
there is misleading / harassing / spamming behavior, and whether the code is readable (deliberately obfuscated code is
rejected).

Once in the Store, **every new upload is reviewed too**; the previously approved version keeps running until the new
one is approved. Abusive plugins are disabled.

---

## Limits and error messages

| What | Limit |
|---|---|
| Code file | single file, ≤1 MB |
| Memory / CPU | 128 MB / 40% 1-minute average |
| Plugins per person | 5 |
| Plugins per server | 25 |
| Error budget | 10 errors in 60 s → plugin stops |
| `chat.send` | 10 messages per 10 s per server (replies included), ≤1024 characters, ≤10 buttons |
| Buttons | 10 clicks per 10 s per person; `update` within 15 minutes of the click |
| `http.fetch` | 60 per minute, body ≤256 KB, response ≤2 MB, ≤15 s |
| Webhooks | 10 per server, 30 calls per minute each, body ≤256 KB |
| Settings | 20 fields |
| Storage | value ≤64 KB, ≤10,000 keys, key ≤200 characters |
| Window | state ≤32 KB; actions 10 per second per user, `data` ≤4 KB |
| Voice | 12 sessions across Bunker |
| Command name | 1-32 characters |

Common errors:

| Error | Cause |
|---|---|
| `… needs the "X" permission (bunker-plugin.json → permissions)` | Permission X is missing from the manifest. |
| `You can't write to this channel (the plugin is not added to this server).` | The channel is on a server the plugin wasn't added to. |
| `Too fast: at most 10 messages per 10 s to a server` | Message limit (per server). |
| `!x is a Bunker command and can't be taken` / `!x is registered by another plugin (…)` | Command name taken; pick another. |
| `value is at most 64 KB` / `state is at most 32 KB` | Value / state too large; split it. |
| `plugin is off` | The old `ctx` was used after the plugin stopped (stop timers in `onUnload`). |
| `x is not in "network" in bunker-plugin.json` | Add the host to `network`. |
| `this address can't be reached` | The host resolves to a private network. |
| `update is only possible within 15 minutes of the click` | Send a new message instead. |
| `A plugin hosted on Bunker cannot use this: …` | Forbidden module or action (internet, files…). |

---

## FAQ

**My plugin doesn't respond.** Is its row "Connected" under Settings → Developer? Is it added under Server settings →
Plugins, and is there a "needs new permission" warning? Is the command name right? The error line shows the reason.

**I need to call an external API.** Code running on Bunker can't reach the internet. Run it on your own computer /
server with `connect` ([testing section](#testing-while-developing-connecting-from-your-computer)); it can run that way permanently too.

**Can I use TypeScript?** Yes; esbuild compiles TypeScript while bundling. Types are included
(`import type { PluginContext } from "@bunker-community/plugin-sdk"`).

**How do I store per-user settings?** Put the server and user id in the key: `ctx.storage.set("config:" + gid + ":" + uid, …)`.

**I lost / leaked my token.** Settings → Developer → **Regenerate token**; the old one stops working immediately.

---

## Appendix A: Gateway protocol (other languages)

The SDK is for Node.js. To write a bot in another language (Python, Go…) that runs on your own machine, connect to
the gateway directly: WebSocket `wss://bunker.community/app/api/plugin/gateway`, JSON text messages, ≤320 KB per
message, ~30 calls per second.

**Hello** (first message, within 10 s) and reply:
```json
{ "op": "hello", "token": "ext-…", "sdk": "0.1.9", "manifest": { "name": "…", "version": "1.0.0", "sdk": "0.1", "permissions": [] }, "uiPage": "<!doctype html>…" }
{ "op": "ready", "v": 1, "sdk": "0.1.6", "manifest": { "…": "…" }, "guilds": [{ "gid": "…", "name": "…" }] }
```

**Call → result:**
```json
{ "op": "call", "id": 7, "method": "chat.send", "args": ["<channel>", "hello"] }
{ "op": "result", "id": 7, "ok": true, "value": { "id": "<message>" } }
```

| method | args | value |
|---|---|---|
| `subscribe` / `unsubscribe` | `[event]` (event names + `"ui.action"`, `"chat.button"`, `"webhook.request"`) | — |
| `command` / `uncommand` | `[name]` | — |
| `chat.send` | `[channel, text]` | `{ id }` or `null` |
| `storage.get` | `[key]` | value or `null` |
| `storage.set` | `[key, value]` | — |
| `storage.delete` | `[key]` | — |
| `storage.keys` | `[prefix]` | `string[]` |
| `ui.setState` | `[{ gid, cid? }, state, { live?, label?, open? }]` | — |
| `voice.join` / `voice.session` | `[cid]` | session state |
| `voice.channelOf` | `[uid]` | `{ gid, cid }` or `null` |
| `voice.members` | `[cid]` | `[{ uid, nick, bot }]` |
| `command` | `[name, opts?]` (opts: description, usage, tr) | — |
| `chat.send` | `[channel, text, { buttons? }]` | `{ id }` or `null` |
| `interaction.reply` | `[token, text, { ephemeral?, buttons? }]` (token from a `command` call or a `chat.button` event) | — |
| `interaction.update` | `[token, { text?, buttons? }]` (button clicks only) | — |
| `guild.info` / `guild.channels` / `guild.roles` / `guild.members` | `[gid]` | as in `ctx.guild` |
| `guild.member` | `[gid, uid]` | member or `null` |
| `http.fetch` | `[url, req]` | `{ status, headers, body }` |
| `webhooks.create` / `webhooks.list` / `webhooks.delete` | `[gid, name]` / `[gid]` / `[id]` | as in `ctx.webhooks` |
| `settings.get` | `[gid]` | values |
| `ui.send` | `[uid, { gid, cid? }, data]` | — |
| `voice.call` | `[cid, action, args[]]` (`playUrl playMedia prefetch stop pause resume setVolume leave`) | session state |
| `log` | `["info" / "warn" / "error", message, extra?]` | — |
| `guilds` | `[]` | `[{ gid, name }]` |

Session state: `{ gid, cid, playing, paused, volume, connected }`.

**From the server:**
```json
{ "op": "event", "name": "member.join", "data": { "gid": "…", "uid": "…" } }
{ "op": "command", "name": "roll", "call": { "gid": "…", "chan": "…", "uid": "…", "nick": "…", "args": "20", "m": { "…": "…" }, "token": "…" } }
{ "op": "event", "name": "chat.button", "data": { "gid": "…", "chan": "…", "msgId": "…", "id": "yes", "uid": "…", "token": "…" } }
{ "op": "voice", "cid": "…", "ev": "started", "args": [], "state": { "…": "…" } }
```
To reply to a command, `interaction.reply` with `call.token` (or `chat.send` to `call.chan`); a button click is answered
with the event's `token` (`interaction.reply` / `interaction.update`). Tokens are valid for 15 minutes. Subscriptions are dropped when the connection closes; send them
again after reconnecting.

**Close codes:** 4001 invalid / regenerated token · 4002 malformed message · 4003 plugin disabled or deleted · 4004
another connection with the same token, or the plugin is running on Bunker · 4005 invalid manifest (reason in
`reason`) · 4008 too fast or not reading messages. Reconnect on any other close.

An IP address that sends 10 invalid tokens within 10 minutes is refused for 15 minutes: the WebSocket upgrade
answers HTTP 429 with a `Retry-After` header. Don't retry after 4001.

---

## Appendix B: Versions

`sdk: "0.1"` in the manifest → works with 0.1.x. Fields are added, never removed; breaking changes bump the version.

| Version | Change |
|---|---|
| 0.1.9 | Buttons under messages (`chat.send` `buttons`, `ctx.chat.onButton`, `update`), ephemeral replies, command descriptions (`ctx.command` opts), `ctx.guild` (`guild.read`), `ctx.http.fetch` (`net.fetch` + manifest `network`), `ctx.webhooks` (`webhooks`), manifest `settings` + `ctx.settings` + `settings.change` |
| 0.1.8 | Window `layout: "stage"`, `ui.embed` + permission `ui.embed` (embedded players), `setState` `label` / `open`, `ctx.voice.members`, page `ctx.stage` |
| 0.1.7 | Languages: `CommandCall.lang`, `ctx.serverLang(gid)`, `UiAction.lang`, page `ctx.lang` |
| 0.1.6 | Manifest `details` (long description for the Store detail view) |
| 0.1.5 | `ctx.voice.channelOf`, `ctx.ui.send` (data to one user's window), `manage` in `CommandCall` / `UiAction` / page `ctx` |
| 0.1.4 | Uploading plugins to Bunker (hosting), connecting from your computer (`connect`) |
| 0.1.3 | `playMedia`, `prefetch`, `meta` event, `silent` in the `error` event |
| 0.1.2 | Voice (`voice.speak`) and panel window (`ui`) |
| 0.1.1 | `guild.install` / `guild.uninstall` events |
| 0.1.0 | Events, commands, storage, messages |

Examples: [github.com/bunker-community/plugin-sdk/tree/main/examples](https://github.com/bunker-community/plugin-sdk/tree/main/examples)
