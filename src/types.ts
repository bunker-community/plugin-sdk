/*
 * Public types of the Bunker plugin API.
 *
 * A plugin never sees the core's internal modules (chat.ts, voice.ts...): only the types here and
 * the PluginContext the runtime provides. Event data is copied from the core; even if the plugin changes it
 * the core is not affected.
 *
 * Backward compatibility: fields CAN be added, never removed/renamed. A breaking change bumps the major
 * version of SDK_VERSION.
 */

/** Permissions a plugin can ask for. A call that needs a permission missing from the manifest throws. */
export type Permission =
  /** message.* events + ctx.command */
  | "events.messages"
  /** voice.* events */
  | "events.voice"
  /** member.*, guild.* events */
  | "events.members"
  /** channel.* events */
  | "events.channels"
  /** user.online / user.offline */
  | "events.presence"
  /** Writing to text channels under the plugin's own name */
  | "chat.send"
  /** Key-value store private to the plugin */
  | "storage"
  /** Joining voice channels and playing audio (ctx.voice) */
  | "voice.speak";

export const PERMISSIONS: readonly Permission[] = [
  "events.messages", "events.voice", "events.members", "events.channels", "events.presence", "chat.send", "storage", "voice.speak",
];

/** Description shown to the server owner when adding to a server (approval screen) */
export const PERMISSION_TEXT: Record<Permission, string> = {
  "events.messages": "Reads messages in text channels and replies to commands",
  "events.voice": "Sees who joins and leaves voice channels",
  "events.members": "Sees members joining and leaving the server",
  "events.channels": "Sees channels being created, changed and deleted",
  "events.presence": "Sees whether members are online",
  "chat.send": "Posts messages in text channels under its own name",
  "storage": "Stores its own data on Bunker",
  "voice.speak": "Joins voice channels and plays audio",
};

/** The window the plugin shows in the panel (manifest "ui"). The page opens in an isolated frame (iframe, sandbox). */
export interface PluginUi {
  /** Window title */
  title: string;
  /** Icon at the bottom left: one of the panel's icon names (e.g. "music", "radio", "tv"); "plug" otherwise */
  icon?: string;
  /** Window page (relative to the plugin folder), e.g. "ui/index.html". A single file is recommended (inline script/style). */
  page: string;
  /** "voice": only visible while in a voice channel of that server (state per channel); "guild": always on the server */
  scope: "voice" | "guild";
}

/** bunker-plugin.json */
export interface PluginManifest {
  /** Lowercase letters, digits, dashes: 2-28 characters. The plugin's permanent identity (storage, settings, bot identity depend on it). */
  id: string;
  /** Display name (also used as the bot name in messages) */
  name: string;
  /** Plugin version (x.y.z) */
  version: string;
  /** Short description (at most 300 characters), shown on Store cards. */
  description?: string;
  /** Long description (at most 4000 characters, plain text; blank lines start a new paragraph), shown in the Store detail view. */
  details?: string;
  author?: string;
  /** Server-side entry file (relative to the plugin folder), default "src/index.ts" */
  main?: string;
  /** Compatible SDK major version, e.g. "0" or "0.1" */
  sdk: string;
  permissions: Permission[];
  /** Panel window (optional) */
  ui?: PluginUi;
}

// ---------------------------------------------------------------- olaylar

/** The message as exposed to the plugin */
export interface PluginMessage {
  id: string;
  ts: number;
  uid: string;
  nick: string;
  text: string;
  /** System line (like "... pinned") */
  system: boolean;
  /** Written by a bot or plugin */
  bot: boolean;
  /** Number of attachments (image/video) */
  attachments: number;
  replyTo?: string;
  edited?: number;
}

/** Text channel or direct message. Direct message events are currently NOT sent to plugins (privacy). */
export type MessageWhere = { scope: "text"; gid: string; chan: string };
export type VoiceWhere = { gid: string; cid: string; uid: string; bot: boolean };

export interface PluginEvents {
  "user.online": { uid: string };
  "user.offline": { uid: string };
  "guild.create": { gid: string; owner: string };
  "guild.delete": { gid: string };
  "member.join": { gid: string; uid: string };
  "member.leave": { gid: string; uid: string };
  "channel.create": { gid: string; kind: "text" | "voice"; id: string };
  "channel.update": { gid: string; kind: "text" | "voice"; id: string };
  "channel.delete": { gid: string; kind: "text" | "voice"; id: string };
  "message.create": MessageWhere & { m: PluginMessage };
  "message.edit": MessageWhere & { m: PluginMessage };
  "message.delete": MessageWhere & { id: string; by: string };
  "message.react": MessageWhere & { id: string; uid: string; emoji: string; added: boolean };
  "voice.join": VoiceWhere;
  "voice.move": VoiceWhere & { from: string };
  "voice.leave": VoiceWhere;
  /** The plugin was added to this server (no permission needed) */
  "guild.install": { gid: string; by: string };
  /** The plugin was removed from this server or the server was deleted (no permission needed); clean up your data for the server here */
  "guild.uninstall": { gid: string };
}
export type PluginEventName = keyof PluginEvents;

/** Event -> required permission (null: no permission needed) */
export const EVENT_PERMISSION: Record<PluginEventName, Permission | null> = {
  "user.online": "events.presence",
  "user.offline": "events.presence",
  "guild.create": "events.members",
  "guild.delete": "events.members",
  "member.join": "events.members",
  "member.leave": "events.members",
  "channel.create": "events.channels",
  "channel.update": "events.channels",
  "channel.delete": "events.channels",
  "message.create": "events.messages",
  "message.edit": "events.messages",
  "message.delete": "events.messages",
  "message.react": "events.messages",
  "voice.join": "events.voice",
  "voice.move": "events.voice",
  "voice.leave": "events.voice",
  "guild.install": null,
  "guild.uninstall": null,
};

// ---------------------------------------------------------------- the interface the runtime provides

export type Awaitable<T> = T | Promise<T>;

/** Languages Bunker supports */
export type Lang = "en" | "tr";

/** A "!command args..." call (text channels only, when a human writes) */
export interface CommandCall {
  gid: string;
  chan: string;
  /** The writer */
  uid: string;
  nick: string;
  /** The text after the command (spaces trimmed) */
  args: string;
  m: PluginMessage;
  /** Does the writer have the server settings permission on this server (server.manage / admin) */
  manage: boolean;
  /** The server's language (Server settings -> Language). Write replies in it: chat messages are not translated per viewer. */
  lang: Lang;
  /** Reply in the same channel under the plugin's name (needs the chat.send permission) */
  reply(text: string): Promise<void>;
}

export interface PluginLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

/** Persistent store private to the plugin (JSON values, at most 64 KB; at most 10,000 keys per plugin) */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

// ---------------------------------------------------------------- voice (voice.speak)
/** The plugin's session in a voice channel. Leaves on its own 60 s after no humans are left in the channel. */
export interface VoiceSession {
  readonly gid: string;
  readonly cid: string;
  /** Is audio flowing right now (true even if paused) */
  readonly playing: boolean;
  readonly paused: boolean;
  /** 0-100 */
  readonly volume: number;
  /** Is the session open (false after leaving; voice.join for a new session) */
  readonly connected: boolean;
  /** Play a 48 kHz, stereo, 16-bit (little-endian) raw PCM stream; stops what is playing */
  playPcm(stream: AsyncIterable<Uint8Array>): void;
  /** Play an http(s) audio address (radio stream, mp3...); the core decodes it with ffmpeg. seek: seconds */
  playUrl(url: string, opts?: { seek?: number }): Promise<void>;
  /**
   * Play a song: a YouTube / SoundCloud link, a radio stream or a search text (searched on YouTube, SoundCloud if
   * blocked). The core decodes it with yt-dlp; the info arrives with the "meta" event.
   */
  playMedia(query: string, opts?: { seek?: number }): Promise<void>;
  /** Decode the next one in advance (faster transition); valid for 30 min */
  prefetch(query: string): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setVolume(v: number): void;
  /** Leave the channel */
  leave(): Promise<void>;
  /** started: the first audio went out; ended: the stream ended; error: could not play; leave: left the channel (reason) */
  on(ev: "started" | "ended", fn: () => Awaitable<void>): () => void;
  on(ev: "error", fn: (why: string, info: { silent: boolean }) => Awaitable<void>): () => void;
  on(ev: "leave", fn: (why: string) => Awaitable<void>): () => void;
  /** playMedia: song info */
  on(ev: "meta", fn: (m: MediaMeta) => Awaitable<void>): () => void;
}
/** Info of the song playing via playMedia (silent errors: YouTube block etc., no need to show them to the user) */
export interface MediaMeta { title: string; artist: string; duration: number; thumb: string; src: string; url: string }

// ---------------------------------------------------------------- panel window (manifest "ui")
/** An action in the panel window (the page sent { bunker: "action", name, data }) */
export interface UiAction {
  gid: string;
  /** the voice channel the person is in if scope is "voice" */
  cid?: string;
  uid: string;
  nick: string;
  name: string;
  data: unknown;
  /** Does the person doing the action have the server settings permission on this server */
  manage: boolean;
  /** The person's panel language (for texts you send only to them with ctx.ui.send) */
  lang: Lang;
}
/**
 * Talking to the window page (window.postMessage):
 *   page -> panel: { bunker: "ready" } | { bunker: "action", name, data } | { bunker: "close" }
 *   panel -> page: { bunker: "state", state, ctx: { gid, cid, me: { uid, nick }, manage, age, lang, theme: { dark, bg, text, muted, accent, border, hover } } }
 *                 | { bunker: "message", data }   (only to this person, via ctx.ui.send)
 *   age: how many ms ago the state was produced (the same state may be sent again; a page counting time/progress adds it)
 *   manage: does the viewer have the server settings permission (display only; the real check is UiAction.manage)
 *   lang: the viewer's panel language ("en" | "tr"); the panel doesn't translate pages, so pick your texts by it
 * The page can't make network requests (CSP); everything happens through state + actions.
 */
export type UiPageMessage = { bunker: "ready" } | { bunker: "action"; name: string; data?: unknown } | { bunker: "close" };

export interface PluginContext {
  readonly manifest: Readonly<PluginManifest>;
  readonly log: PluginLogger;
  /** Listen to an event (needs the permission). The returned function stops listening; all are released when the plugin stops. */
  on<K extends PluginEventName>(name: K, fn: (payload: PluginEvents[K]) => Awaitable<void>): () => void;
  /** A "!name" command (events.messages permission). The name is lowercased, written without "!". */
  command(name: string, fn: (call: CommandCall) => Awaitable<void>): () => void;
  readonly chat: {
    /** Message to a text channel under the plugin's name (chat.send). Can't write to a server the plugin isn't added to. */
    send(chan: string, text: string): Promise<{ id: string } | null>;
  };
  readonly storage: PluginStorage;
  /** A server's language (Server settings -> Language): write messages to that server in it. "en" if the plugin isn't added there. */
  serverLang(gid: string): Promise<Lang>;
  readonly voice: {
    /** Join a voice channel (voice.speak). The plugin must be added to that channel's server. Returns the same session if already there. */
    join(cid: string): Promise<VoiceSession>;
    /** Open session (null if none) */
    session(cid: string): VoiceSession | null;
    /** The voice channel the person is in right now (voice.speak or events.voice). null if on a server the plugin isn't added to. */
    channelOf(uid: string): Promise<{ gid: string; cid: string } | null>;
  };
  readonly ui: {
    /**
     * The window's state (needs manifest "ui"): JSON, at most 32 KB. Goes live to everyone on the server (for scope "voice"
     * cid is given, that channel's window). live: light up the icon at the bottom left (e.g. while playing). null = clear.
     */
    setState(where: { gid: string; cid?: string }, state: unknown, opts?: { live?: boolean }): void;
    /** An action in the window */
    onAction(fn: (a: UiAction) => Awaitable<void>): () => void;
    /**
     * Data to only one person's open window (goes to the page as { bunker: "message", data }): e.g. the reply to an
     * action. JSON, at most 128 KB. Lost if the person doesn't have that window open.
     */
    send(uid: string, where: { gid: string; cid?: string }, data: unknown): void;
  };
  /** Cleanup to run when the plugin stops */
  onUnload(fn: () => Awaitable<void>): void;
}

export interface PluginDefinition {
  /** Called once when the plugin starts. Set up listeners here. */
  setup(ctx: PluginContext): Awaitable<void>;
}
