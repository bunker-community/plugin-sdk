/*
 * Bunker plugin API'sinin genel tipleri.
 *
 * Plugin cekirdegin ic modullerini (chat.ts, voice.ts...) hic gormez: sadece buradaki tipler ve
 * calisma ortaminin verdigi PluginContext. Olay verileri cekirdekten kopyalanir; plugin degistirse de
 * cekirdek etkilenmez.
 *
 * Geriye uyumluluk: alan EKLENEBILIR, silinmez/yeniden adlandirilmaz. Kiran degisiklik SDK_VERSION'in
 * ana (major) surumunu artirir.
 */

/** Plugin'in isteyebilecegi izinler. Manifest'te yazilmayan izin gerektiren cagri hata verir. */
export type Permission =
  /** message.* olaylari + ctx.command */
  | "events.messages"
  /** voice.* olaylari */
  | "events.voice"
  /** member.*, guild.* olaylari */
  | "events.members"
  /** channel.* olaylari */
  | "events.channels"
  /** user.online / user.offline */
  | "events.presence"
  /** Metin kanalina plugin'in kendi adiyla mesaj yazma */
  | "chat.send"
  /** Plugin'e ozel anahtar-deger deposu */
  | "storage"
  /** Ses kanalina katilip ses calma (ctx.voice) */
  | "voice.speak";

export const PERMISSIONS: readonly Permission[] = [
  "events.messages", "events.voice", "events.members", "events.channels", "events.presence", "chat.send", "storage", "voice.speak",
];

/** Sunucuya eklerken sunucu sahibine gosterilen aciklama (onay ekrani) */
export const PERMISSION_TEXT: Record<Permission, string> = {
  "events.messages": "Metin kanallarındaki mesajları okur, komutlara cevap verir",
  "events.voice": "Ses kanallarına kimin girip çıktığını görür",
  "events.members": "Sunucuya katılan ve ayrılan üyeleri görür",
  "events.channels": "Kanalların açılmasını, değişmesini ve silinmesini görür",
  "events.presence": "Üyelerin çevrimiçi olup olmadığını görür",
  "chat.send": "Metin kanallarına kendi adıyla mesaj yazar",
  "storage": "Kendi verilerini Bunker'da saklar",
  "voice.speak": "Ses kanallarına katılır ve ses çalar",
};

/** Plugin'in panelde gosterdigi pencere (manifest "ui"). Sayfa izole bir cercevede (iframe, sandbox) acilir. */
export interface PluginUi {
  /** Pencere basligi */
  title: string;
  /** Sol alttaki ikon: panelin ikon adlarindan biri (or. "music", "radio", "tv"); yoksa "plug" */
  icon?: string;
  /** Pencere sayfasi (plugin klasorune gore), or. "ui/index.html". Tek dosya olmasi onerilir (satir ici script/stil). */
  page: string;
  /** "voice": sadece o sunucunun bir ses kanalindayken gorunur (durum kanal basina); "guild": sunucuda her zaman */
  scope: "voice" | "guild";
}

/** bunker-plugin.json */
export interface PluginManifest {
  /** Kucuk harf, rakam, tire: 2-28 karakter. Plugin'in kalici kimligi (depo, ayarlar, bot kimligi buna bagli). */
  id: string;
  /** Gorunen ad (mesajlarda bot adi olarak da kullanilir) */
  name: string;
  /** Plugin surumu (x.y.z) */
  version: string;
  description?: string;
  author?: string;
  /** Sunucu tarafi giris dosyasi (plugin klasorune gore), varsayilan "src/index.ts" */
  main?: string;
  /** Uyumlu SDK ana surumu, or. "0" ya da "0.1" */
  sdk: string;
  permissions: Permission[];
  /** Panel penceresi (istege bagli) */
  ui?: PluginUi;
}

// ---------------------------------------------------------------- olaylar

/** Mesajin plugin'e acilan hali */
export interface PluginMessage {
  id: string;
  ts: number;
  uid: string;
  nick: string;
  text: string;
  /** Sistem satiri ("... sabitledi" gibi) */
  system: boolean;
  /** Bot ya da plugin yazdi */
  bot: boolean;
  /** Ek sayisi (gorsel/video) */
  attachments: number;
  replyTo?: string;
  edited?: number;
}

/** Metin kanali ya da ozel mesaj. Ozel mesaj olaylari plugin'lere su an GONDERILMEZ (gizlilik). */
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
  /** Plugin bu sunucuya eklendi (izin gerekmez) */
  "guild.install": { gid: string; by: string };
  /** Plugin bu sunucudan cikarildi ya da sunucu silindi (izin gerekmez); sunucuya ait verini burada temizle */
  "guild.uninstall": { gid: string };
}
export type PluginEventName = keyof PluginEvents;

/** Olay -> gereken izin (null: izin gerekmez) */
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

// ---------------------------------------------------------------- calisma ortaminin verdigi arayuz

export type Awaitable<T> = T | Promise<T>;

/** "!komut arguman..." cagrisi (sadece metin kanallarinda, insan yazdiginda) */
export interface CommandCall {
  gid: string;
  chan: string;
  /** Yazan */
  uid: string;
  nick: string;
  /** Komuttan sonraki metin (bosluklar kirpilmis) */
  args: string;
  m: PluginMessage;
  /** Ayni kanala plugin adiyla cevap (chat.send izni gerekir) */
  reply(text: string): Promise<void>;
}

export interface PluginLogger {
  info(msg: string, ctx?: Record<string, unknown>): void;
  warn(msg: string, ctx?: Record<string, unknown>): void;
  error(msg: string, ctx?: Record<string, unknown>): void;
}

/** Plugin'e ozel kalici depo (deger JSON, en fazla 64 KB; plugin basina en fazla 10 000 anahtar) */
export interface PluginStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(prefix?: string): Promise<string[]>;
}

// ---------------------------------------------------------------- ses (voice.speak)
/** Plugin'in bir ses kanalindaki oturumu. Kanalda insan kalmazsa 60 sn sonra kendiliginden ayrilir. */
export interface VoiceSession {
  readonly gid: string;
  readonly cid: string;
  /** Su an ses akiyor mu (duraklatilmis olsa da true) */
  readonly playing: boolean;
  readonly paused: boolean;
  /** 0-100 */
  readonly volume: number;
  /** Oturum acik mi (ayrildiysa false; yeni oturum icin voice.join) */
  readonly connected: boolean;
  /** 48 kHz, stereo, 16 bit (little-endian) ham PCM akisini cal; caldigini durdurur */
  playPcm(stream: AsyncIterable<Uint8Array>): void;
  /** http(s) ses adresini cal (radyo yayini, mp3...); cekirdek ffmpeg ile cozer. seek: saniye */
  playUrl(url: string, opts?: { seek?: number }): Promise<void>;
  /**
   * Sarki cal: YouTube / SoundCloud baglantisi, radyo yayini ya da arama metni (YouTube'da aranir, engellenirse
   * SoundCloud). Cekirdek yt-dlp ile cozer; bilgi "meta" olayiyla gelir.
   */
  playMedia(query: string, opts?: { seek?: number }): Promise<void>;
  /** Siradakini onceden coz (gecis hizlansin); 30 dk gecerli */
  prefetch(query: string): void;
  stop(): void;
  pause(): void;
  resume(): void;
  setVolume(v: number): void;
  /** Kanaldan ayril */
  leave(): Promise<void>;
  /** started: ilk ses gitti; ended: akis bitti; error: calinamadi; leave: kanaldan ayrildi (neden) */
  on(ev: "started" | "ended", fn: () => Awaitable<void>): () => void;
  on(ev: "error", fn: (why: string, info: { silent: boolean }) => Awaitable<void>): () => void;
  on(ev: "leave", fn: (why: string) => Awaitable<void>): () => void;
  /** playMedia: sarki bilgisi */
  on(ev: "meta", fn: (m: MediaMeta) => Awaitable<void>): () => void;
}
/** playMedia ile calan sarkinin bilgisi (silent hatalar: YouTube engeli vb., kullaniciya gostermek sart degil) */
export interface MediaMeta { title: string; artist: string; duration: number; thumb: string; src: string; url: string }

// ---------------------------------------------------------------- panel penceresi (manifest "ui")
/** Panel penceresinde yapilan islem (sayfa { bunker: "action", name, data } gonderdi) */
export interface UiAction {
  gid: string;
  /** scope "voice" ise kisinin bulundugu ses kanali */
  cid?: string;
  uid: string;
  nick: string;
  name: string;
  data: unknown;
}
/**
 * Pencere sayfasiyla konusma (window.postMessage):
 *   sayfa -> panel: { bunker: "ready" } | { bunker: "action", name, data } | { bunker: "close" }
 *   panel -> sayfa: { bunker: "state", state, ctx: { gid, cid, me: { uid, nick }, age, theme: { dark, bg, text, muted, accent, border, hover } } }
 *   age: durum kac ms once uretildi (ayni durum tekrar gonderilebilir; sure/ilerleme sayan sayfa bunu ekler)
 * Sayfa ag istegi yapamaz (CSP); her sey durum + islemlerle olur.
 */
export type UiPageMessage = { bunker: "ready" } | { bunker: "action"; name: string; data?: unknown } | { bunker: "close" };

export interface PluginContext {
  readonly manifest: Readonly<PluginManifest>;
  readonly log: PluginLogger;
  /** Olay dinle (izin gerekir). Donen fonksiyon dinlemeyi birakir; plugin kapaninca hepsi kendiliginden birakilir. */
  on<K extends PluginEventName>(name: K, fn: (payload: PluginEvents[K]) => Awaitable<void>): () => void;
  /** "!ad" komutu (events.messages izni). Ad kucuk harfe cevrilir, "!" yazilmaz. */
  command(name: string, fn: (call: CommandCall) => Awaitable<void>): () => void;
  readonly chat: {
    /** Metin kanalina plugin adiyla mesaj (chat.send). Plugin'in ekli olmadigi sunucuya yazamaz. */
    send(chan: string, text: string): Promise<{ id: string } | null>;
  };
  readonly storage: PluginStorage;
  readonly voice: {
    /** Ses kanalina katil (voice.speak). Plugin bu kanalin sunucusuna ekli olmali. Zaten oradaysa ayni oturum doner. */
    join(cid: string): Promise<VoiceSession>;
    /** Acik oturum (yoksa null) */
    session(cid: string): VoiceSession | null;
  };
  readonly ui: {
    /**
     * Pencerenin durumu (manifest "ui" gerekir): JSON, en fazla 32 KB. Sunucudaki herkese (scope "voice" ise
     * cid verilir, o kanalin penceresi) anlik gider. live: sol alttaki ikon yansin (or. calarken). null = temizle.
     */
    setState(where: { gid: string; cid?: string }, state: unknown, opts?: { live?: boolean }): void;
    /** Pencerede yapilan islem */
    onAction(fn: (a: UiAction) => Awaitable<void>): () => void;
  };
  /** Plugin kapanirken calisacak temizlik */
  onUnload(fn: () => Awaitable<void>): void;
}

export interface PluginDefinition {
  /** Plugin acilinca bir kez cagrilir. Dinleyicileri burada kur. */
  setup(ctx: PluginContext): Awaitable<void>;
}
