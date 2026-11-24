# Changelog

## 0.1.9
- Buttons under bot messages: `chat.send(chan, text, { buttons })`, `ctx.chat.onButton`, `click.update` / `click.reply`.
- Ephemeral replies: `reply(text, { ephemeral: true })` for commands and button clicks.
- Command descriptions for the panel's command list: `ctx.command(name, fn, { description, usage, tr })`.
- `ctx.guild` (permission `guild.read`): server info, channels, roles, members.
- `ctx.http.fetch` (permission `net.fetch` + manifest `network`): requests to outside services.
- `ctx.webhooks` (permission `webhooks`): incoming webhook addresses.
- Manifest `settings` + `ctx.settings.get` + the `settings.change` event: per-server settings filled in by the server owner.

## 0.1.8
- Window `layout: "stage"`: the page fills the chat area (players, games).
- Manifest `ui.embed` + permission `ui.embed`: frames and scripts from other https origins (video players).
- `ctx.ui.setState` options `label` (tooltip next to the voice channel while live) and `open` (open the window for the people it applies to).
- `ctx.voice.members(cid)`; the page's `ctx.stage`.

## 0.1.7
- Languages: `CommandCall.lang` and `ctx.serverLang(gid)` (the server's language, for chat messages), `UiAction.lang` and the page's `ctx.lang` (the viewer's panel language).

## 0.1.6
- Manifest `details`: long description shown in the Store detail view (up to 4000 characters).

## 0.1.5
- `ctx.voice.channelOf(uid)`, `ctx.ui.send(uid, where, data)` (data to one user's window: `{ bunker: "message", data }`).
- `manage` in `CommandCall`, `UiAction` and the window page `ctx`.
- `chat.send` limit is now per server (10 messages per 10 s).

## 0.1.4
- Upload plugins to Bunker (they run in a restricted environment on your servers right away; Store needs review).
- `connect(plugin, { token })` to run a plugin from your own computer.

## 0.1.3
- `VoiceSession.playMedia`, `prefetch`, `meta` event, `error` with `{ silent }`.

## 0.1.2
- Voice (`voice.speak`, `ctx.voice`, `playPcm`, `playUrl`) and panel window (`ui`, `ctx.ui`).

## 0.1.1
- `guild.install` / `guild.uninstall` events.

## 0.1.0
- Events, commands, storage, messages, manifest validation.
