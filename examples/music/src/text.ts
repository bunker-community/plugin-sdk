/*
 * Music Bot texts. Chat replies use the server's language (CommandCall.lang), window errors the viewer's
 * language (UiAction.lang). Code throws UserError(key, vars); the catcher translates it with the right language.
 */
import type { Lang } from "@bunker-community/plugin-sdk";

const TEXT = {
  en: {
    help: "Commands: [b]!play[/b] <song/link>, [b]!list[/b] <list name>, [b]!pause[/b], [b]!resume[/b], [b]!skip[/b], [b]!stop[/b], [b]!vol[/b] <0-100>, [b]!queue[/b], [b]!np[/b]. Type them while in a voice channel of this server. Window: the music icon at the bottom left.",
    joinVoice: "Join a voice channel of this server first.",
    whatToPlay: "What should I play? Example: [b]!play daft punk one more time[/b]",
    queued: "Added to the queue: {title}",
    playing: "Playing: {title}",
    lists: "Lists: {names}. Example: [b]!list {first}[/b]",
    noLists: "No lists on this server.",
    noSuchList: "No list named \"{want}\". Lists: {names}",
    listQueued: "{n} songs from {name} added to the queue",
    paused: "{nick} paused the music",
    resumed: "Resumed",
    nothingPlaying: "Nothing is playing right now.",
    skipped: "Skipped: {title}",
    alreadyOff: "The bot is already off.",
    stopped: "{nick} stopped the music",
    notHere: "The bot isn't in this channel.",
    volume: "Bot volume: {v}%",
    volumeSet: "Bot volume {v}%",
    queueEmpty: "The queue is empty.",
    queueHead: "Up next ({n}):",
    nowPlaying: "Playing: {title} (added by {nick})",
    queueFull: "The queue is full ({n}).",
    listNotFound: "List not found.",
    onlyOwnerEdit: "Only its creator or a server admin can edit this list.",
    onlyOwnerDelete: "Only its creator or a server admin can delete this list.",
    maxLists: "A server can have at most {n} lists.",
    listName: "Give the list a name.",
    listEmpty: "Add at least one song to the list (one song name or link per line).",
    listTooLong: "A list can have at most {n} songs.",
  },
  tr: {
    help: "Komutlar: [b]!play[/b] <şarkı/bağlantı>, [b]!liste[/b] <liste adı>, [b]!pause[/b], [b]!devam[/b], [b]!skip[/b], [b]!stop[/b], [b]!vol[/b] <0-100>, [b]!kuyruk[/b], [b]!np[/b]. Bu sunucunun bir ses kanalındayken yaz. Pencere: sol alttaki müzik ikonu.",
    joinVoice: "Önce bu sunucunun bir ses kanalına katıl.",
    whatToPlay: "Ne çalayım? Örnek: [b]!play mor ve ötesi cambaz[/b]",
    queued: "Sıraya eklendi: {title}",
    playing: "Çalıyor: {title}",
    lists: "Listeler: {names}. Örnek: [b]!liste {first}[/b]",
    noLists: "Bu sunucuda liste yok.",
    noSuchList: "\"{want}\" adında liste yok. Listeler: {names}",
    listQueued: "{name} listesinden {n} şarkı sıraya eklendi",
    paused: "{nick} müziği duraklattı",
    resumed: "Devam ediyor",
    nothingPlaying: "Şu an bir şey çalmıyor.",
    skipped: "Geçildi: {title}",
    alreadyOff: "Bot zaten kapalı.",
    stopped: "{nick} müziği kapattı",
    notHere: "Bot bu kanalda değil.",
    volume: "Bot sesi: %{v}",
    volumeSet: "Bot sesi %{v}",
    queueEmpty: "Kuyruk boş.",
    queueHead: "Sırada ({n}):",
    nowPlaying: "Çalıyor: {title} ({nick} ekledi)",
    queueFull: "Sıra dolu ({n}).",
    listNotFound: "Liste bulunamadı.",
    onlyOwnerEdit: "Bu listeyi sadece oluşturan ya da sunucu yöneticisi düzenleyebilir.",
    onlyOwnerDelete: "Bu listeyi sadece oluşturan ya da sunucu yöneticisi silebilir.",
    maxLists: "Bir sunucuda en fazla {n} liste olabilir.",
    listName: "Listeye bir ad ver.",
    listEmpty: "Listeye en az bir şarkı ekle (her satıra bir şarkı adı ya da bağlantı).",
    listTooLong: "Bir listede en fazla {n} şarkı olabilir.",
  },
} as const;

export type TextKey = keyof typeof TEXT.en;

export function t(lang: Lang, key: TextKey, vars: Record<string, string | number> = {}) {
  const s: string = TEXT[lang]?.[key] ?? TEXT.en[key];
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

/** An error meant for the user: translated where it is caught */
export class UserError extends Error {
  key: TextKey;
  vars: Record<string, string | number>;
  constructor(key: TextKey, vars: Record<string, string | number> = {}) {
    super(t("en", key, vars));
    this.key = key;
    this.vars = vars;
  }
}

/** Message of a caught error in the given language (other errors as they are) */
export const errorText = (e: unknown, lang: Lang) => (e instanceof UserError ? t(lang, e.key, e.vars) : (e as Error)?.message ?? String(e));
