# Changelog

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
