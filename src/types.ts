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
  | "voice.speak"
  /** Showing content from other websites in the window (manifest ui.embed: video players etc.) */
  | "ui.embed"
  /** Reading the server's channels, roles and member list (ctx.guild) */
  | "guild.read"
  /** Requests to outside services, only to the hosts in manifest "network" (ctx.http) */
  | "net.fetch"
  /** Receiving notifications from outside services (ctx.webhooks) */
  | "webhooks";

export const PERMISSIONS: readonly Permission[] = [
  "events.messages", "events.voice", "events.members", "events.channels", "events.presence", "chat.send", "storage", "voice.speak", "ui.embed", "guild.read", "net.fetch", "webhooks",
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
  "ui.embed": "Shows content from other websites in its window (like video players)",
  "guild.read": "Sees the server's channels, roles and member list",
  "net.fetch": "Connects to outside services on the internet (only the addresses it lists)",
  "webhooks": "Receives notifications from outside services (webhooks)",
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
  /**
   * Where the page opens: "window" (default) a window over the panel; "stage" the big area where the chat is
   * (like a video call or screen share; for players, games). (SDK 0.1.8)
   */
  layout?: "window" | "stage";
  /**
   * Other websites the page may embed (frames and their scripts), as https origins: "https://www.youtube.com",
   * "https://*.vimeo.com". At most 16. Needs the "ui.embed" permission. (SDK 0.1.8)
   */
  embed?: string[];
}

/**
 * A per-server setting (manifest "settings"). key: [a-zA-Z0-9_]{1,32}. label/description are English; tr gives the Turkish ones.
 * text: maxLength (default 200, at most 1000); number: min/max; select: options; channel: a text channel of the server
 * (voice: true for a voice channel); role: a role of the server.
 */
export interface SettingField {
  key: string;
  type: "text" | "number" | "boolean" | "select" | "channel" | "role";
  label: string;
  description?: string;
  tr?: { label?: string; description?: string; options?: Record<string, string> };
  default?: string | number | boolean | null;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  maxLength?: number;
  voice?: boolean;
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
  /**
   * Hosts ctx.http.fetch may reach (needs "net.fetch"): "api.example.com" or "*.example.com", at most 16.
   * Shown to the server owner when adding the plugin. (SDK 0.1.9)
   */
  network?: string[];
  /** Per-server settings the server owner fills in (Server settings -> Plugins -> Settings); read with ctx.settings. At most 20. (SDK 0.1.9) */
  settings?: SettingField[];
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
  /** The server owner saved the plugin's settings on a server (no permission needed). values: all settings with defaults. */
  "settings.change": { gid: string; values: Record<string, unknown> };
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
  "settings.change": null,
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
  /**
   * Reply in the same channel under the plugin's name (needs the chat.send permission).
   * opts.ephemeral: only the writer sees it (not stored, disappears when they reload); opts.buttons: buttons under it.
   */
  reply(text: string, opts?: ReplyOptions): Promise<void>;
}

/**
 * A button under a bot message. id: what your onButton handler gets (1-40 characters). A link button has url (https)
 * instead of id and opens the address; it doesn't reach the plugin. At most 10 buttons per message, label at most 40.
 */
export type MessageButton =
  | { id: string; label: string; style?: "primary" | "secondary" | "success" | "danger"; disabled?: boolean }
  | { url: string; label: string };
export interface SendOptions { buttons?: MessageButton[] }
export interface ReplyOptions extends SendOptions { ephemeral?: boolean }

/** Someone clicked a button under the plugin's message (ctx.chat.onButton) */
export interface ButtonClick {
  gid: string;
  chan: string;
  /** The message the button is under */
  msgId: string;
  /** The button's id */
  id: string;
  uid: string;
  nick: string;
  manage: boolean;
  /** The server's language (for messages to the channel) */
  lang: Lang;
  /** The clicker's panel language (for ephemeral replies only they see) */
  userLang: Lang;
  /** Reply in the channel (ephemeral: only the clicker sees it) */
  reply(text: string, opts?: ReplyOptions): Promise<void>;
  /** Change this message: its text and/or buttons (buttons: [] removes them). Within 15 minutes of the click. */
  update(p: { text?: string; buttons?: MessageButton[] }): Promise<void>;
}

/** A command registered with ctx.command (shown in the panel's command list while typing "!") */
export interface CommandOptions {
  /** What it does (at most 100 characters) */
  description?: string;
  /** Arguments, e.g. "<song or link>" (at most 60 characters) */
  usage?: string;
  /** Turkish description / usage (the panel shows them in Turkish) */
  tr?: { description?: string; usage?: string };
}

/** ctx.guild (guild.read) */
export interface GuildInfo { id: string; name: string; owner: string; members: number; lang: Lang; created: number }
export interface GuildChannel { id: string; kind: "text" | "voice"; name: string; parent?: string }
export interface GuildRole { id: string; name: string; color: string; position: number; admin: boolean }
export interface GuildMember { uid: string; nick: string; roles: string[]; online: boolean; bot: boolean; joined?: number }

/** ctx.http.fetch (net.fetch) */
export interface HttpRequest {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: Record<string, string>;
  /** Text body (JSON.stringify yourself), at most 256 KB */
  body?: string;
  /** ms, at most 15000 (default 10000) */
  timeout?: number;
}
export interface HttpResponse {
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  /** The body as text (at most 2 MB) */
  body: string;
  json<T = unknown>(): T;
}

/** An incoming webhook call (ctx.webhooks.onRequest). The sender got "202 Accepted" already. */
export interface WebhookRequest {
  hookId: string;
  gid: string;
  name: string;
  method: string;
  /** Lowercase header names (cookies are removed) */
  headers: Record<string, string>;
  query: Record<string, string>;
  /** The raw body as text (at most 256 KB); verify signatures (e.g. GitHub's X-Hub-Signature-256) with it */
  body: string;
}
export interface WebhookInfo { id: string; gid: string; name: string; created: number }

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
/** A person (or bot) in a voice channel (ctx.voice.members) */
export interface VoiceMember { uid: string; nick: string; bot: boolean }
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
 *   stage: does the page fill the chat area (manifest ui.layout "stage")
 * The page can't make network requests (CSP); everything happens through state + actions. Pages are served from a
 * separate origin for plugin content, so localStorage works there; it is shared by all plugin pages: prefix keys with your id.
 * Frames/scripts from the origins in manifest ui.embed are allowed; media (<video>/<audio>) from any https address and blob:.
 */
export type UiPageMessage = { bunker: "ready" } | { bunker: "action"; name: string; data?: unknown } | { bunker: "close" };

export interface UiStateOptions { live?: boolean; label?: string; open?: boolean }

export interface PluginContext {
  readonly manifest: Readonly<PluginManifest>;
  readonly log: PluginLogger;
  /** Listen to an event (needs the permission). The returned function stops listening; all are released when the plugin stops. */
  on<K extends PluginEventName>(name: K, fn: (payload: PluginEvents[K]) => Awaitable<void>): () => void;
  /**
   * A "!name" command (events.messages permission). The name is lowercased, written without "!".
   * opts (SDK 0.1.9): description / usage shown in the panel's command list while typing "!".
   */
  command(name: string, fn: (call: CommandCall) => Awaitable<void>, opts?: CommandOptions): () => void;
  readonly chat: {
    /** Message to a text channel under the plugin's name (chat.send). Can't write to a server the plugin isn't added to. opts.buttons: buttons under it. */
    send(chan: string, text: string, opts?: SendOptions): Promise<{ id: string } | null>;
    /** A button under one of the plugin's messages was clicked (chat.send). (SDK 0.1.9) */
    onButton(fn: (b: ButtonClick) => Awaitable<void>): () => void;
  };
  /** The server's details (guild.read). Only servers the plugin is added to. (SDK 0.1.9) */
  readonly guild: {
    info(gid: string): Promise<GuildInfo | null>;
    channels(gid: string): Promise<GuildChannel[]>;
    roles(gid: string): Promise<GuildRole[]>;
    /** All members (at most 5000) */
    members(gid: string): Promise<GuildMember[]>;
    member(gid: string, uid: string): Promise<GuildMember | null>;
  };
  /** Requests to outside services (net.fetch): https only, hosts in manifest "network", 60 per minute. (SDK 0.1.9) */
  readonly http: {
    fetch(url: string, req?: HttpRequest): Promise<HttpResponse>;
  };
  /**
   * Incoming webhooks (webhooks): an address per server that outside services (GitHub, Twitch...) post to. At most 10 per
   * server, 30 calls per minute each. The address is shown only when it is created: give it to the server admin. (SDK 0.1.9)
   */
  readonly webhooks: {
    create(gid: string, name: string): Promise<WebhookInfo & { url: string }>;
    list(gid: string): Promise<WebhookInfo[]>;
    delete(id: string): Promise<void>;
    onRequest(fn: (r: WebhookRequest) => Awaitable<void>): () => void;
  };
  /** Per-server settings (manifest "settings"), with defaults filled in. Changes arrive as the "settings.change" event. (SDK 0.1.9) */
  readonly settings: {
    get(gid: string): Promise<Record<string, unknown>>;
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
    /** Who is in a voice channel right now (voice.speak or events.voice); [] for a channel of a server the plugin isn't added to. (SDK 0.1.8) */
    members(cid: string): Promise<VoiceMember[]>;
  };
  readonly ui: {
    /**
     * The window's state (needs manifest "ui"): JSON, at most 32 KB. Goes live to everyone on the server (for scope "voice"
     * cid is given, that channel's window). null = clear.
     * opts.live: light up the icon at the bottom left (e.g. while playing); for scope "voice" the icon also shows next to the
     *   channel in the channel list, with opts.label (at most 100 characters) as its tooltip.
     * opts.open: open the window for the people it applies to (in that voice channel / on the server) right now, e.g. when
     *   a video starts. Once per 10 s per channel at most; someone who closed it by hand gets it again on the next open. (SDK 0.1.8)
     */
    setState(where: { gid: string; cid?: string }, state: unknown, opts?: UiStateOptions): void;
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
