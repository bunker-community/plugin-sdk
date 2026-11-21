# Bunker Plugin SDK (`@bunker-community/plugin-sdk` 0.1.4)

Bunker'a bot / plugin yazmak için API belgesi.

Bir plugin iki şekilde çalışır, **kodu ve arayüzü aynıdır** (`definePlugin({ setup(ctx) {…} })`):

| | Uzak plugin (herkes) | Bunker içinde (birinci taraf) |
|---|---|---|
| Kod nerede çalışır | Senin bilgisayarında / sunucunda, ya da onaylanınca Bunker'da kısıtlı süreçte ([barındırma](#bunkerda-çalıştırma-barındırma)) | Bunker sunucusunda, `plugins/<id>/` |
| Bağlantı | `connect(plugin, { token })` → geçit (WebSocket) | Bunker yükler |
| Kim ekler | Kendin: Ayarlar → Geliştirici | Bunker ekibi (repo + deploy) |
| Hangi sunuculara eklenir | Doğrulanmamışken sadece senin yönettiğin sunuculara; site yöneticisi Store'a alırsa (doğrulandı) herkes | Site yöneticisi listelerse herkes |
| Fark | Ses kanalına ham PCM gönderemez (`playPcm` yok); kod kapalıyken bot çevrimdışı görünür | — |

## İçindekiler
1. [Hızlı başlangıç](#hızlı-başlangıç)
2. [Manifest: `bunker-plugin.json`](#manifest-bunker-pluginjson)
3. [İzinler](#izinler)
4. [Yaşam döngüsü](#yaşam-döngüsü)
5. [`PluginContext` (ctx)](#plugincontext-ctx)
6. [Olaylar](#olaylar)
7. [Komutlar](#komutlar)
8. [Mesaj gönderme](#mesaj-gönderme)
9. [Depo](#depo)
10. [Ses](#ses)
11. [Pencere (panel arayüzü)](#pencere-panel-arayüzü)
12. [Bunker'da çalıştırma (barındırma)](#bunkerda-çalıştırma-barındırma)
13. [Sınırlar](#sınırlar)
14. [Sürümler ve uyumluluk](#sürümler-ve-uyumluluk)
15. [Yayınlama ve sunucuya ekleme](#yayınlama-ve-sunucuya-ekleme)
16. [Geçit protokolü (SDK'sız bağlanmak)](#geçit-protokolü-sdksız-bağlanmak)
17. [Örnekler](#örnekler)

---

## Hızlı başlangıç

### Uzak plugin (kendi bilgisayarında)

1. Bunker'da **Ayarlar → Geliştirici → Yeni plugin**: ad yaz, "Oluştur". Çıkan **anahtarı** kopyala (bir kez
   gösterilir; kaybedersen "Anahtarı yenile").
2. Boş bir klasörde (Node.js 22+):

```bash
npm init -y
npm install @bunker-community/plugin-sdk
```

`package.json`'a `"type": "module"` ekle. Klasöre iki dosya:

`bunker-plugin.json` (id yazma, anahtardan gelir)
```json
{
  "name": "Selam Botu",
  "version": "0.1.0",
  "description": "!selam yazana cevap verir.",
  "sdk": "0.1",
  "permissions": ["events.messages", "chat.send", "storage"]
}
```

`index.js`
```js
import { connect, definePlugin } from "@bunker-community/plugin-sdk";

const plugin = definePlugin({
  setup(ctx) {
    ctx.command("selam", async (c) => {
      const n = ((await ctx.storage.get(`n:${c.uid}`)) ?? 0) + 1;
      await ctx.storage.set(`n:${c.uid}`, n);
      await c.reply(`Selam ${c.nick}! (${n}. kez)`);
    });
  },
});

connect(plugin, { token: process.env.BUNKER_TOKEN });
```

3. Çalıştır: `BUNKER_TOKEN=<anahtar> node index.js` (PowerShell: `$env:BUNKER_TOKEN="<anahtar>"; node index.js`).
   "bağlandı" yazınca Ayarlar → Geliştirici'de plugin "Bağlı" görünür.
4. Kendi sunucunda **Sunucu ayarları → Plugin'ler** (ya da Plugin Store) → Ekle → izinleri onayla.
   Kanalda `!selam` yaz.

TypeScript kullanıyorsan tipler pakette var (`import type { PluginContext } from "@bunker-community/plugin-sdk"`).

`connect(plugin, options)`:

| Seçenek | Açıklama |
|---|---|
| `token` | Zorunlu. Anahtarı koda yazma, ortam değişkeninden oku. |
| `url` | Geçit adresi, varsayılan `wss://bunker.community/app/api/plugin/gateway`. |
| `manifest` | Manifest nesnesi. Verilmezse `dir` içindeki `bunker-plugin.json` okunur, o da yoksa Bunker'da kayıtlı olan kullanılır. |
| `dir` | `bunker-plugin.json` ve pencere sayfasının klasörü (varsayılan çalışma klasörü). |
| `uiPage` | Pencere sayfasının HTML'i (verilmezse `manifest.ui.page` dosyası `dir`'den okunur). |
| `logger` | Bağlantı kayıtları için (varsayılan `console`). |

Döner: `{ ready: Promise<void>, connected: boolean, close(): Promise<void> }`. Bağlantı koparsa kendiliğinden
yeniden bağlanır (1 sn → 30 sn arası bekleyerek), dinleyiciler ve komutlar yeniden kaydedilir. Anahtar geçersiz,
plugin kapatılmış, manifest geçersiz ya da aynı anahtarla başka bağlantı açılmışsa yeniden denemez ve
`ready` hata verir.

Her bağlanışta manifest ve pencere sayfası Bunker'a gönderilir; değiştiyse orada güncellenir. Yeni izin
eklediysen, eklendiği sunucularda yeniden onaylanana kadar plugin o sunucularda çalışmaz.

Kod kapalıyken: bot üye listesinde çevrimdışı görünür, komutlara cevap gelmez, ses oturumları kapanır.
Sürekli açık kalması için kodu bir sunucuda (VPS, Raspberry Pi…) `pm2` ya da systemd ile çalıştır.

### Bunker içinde (birinci taraf)

```
plugins/selam/
├── bunker-plugin.json
├── package.json
├── tsconfig.json
└── src/index.ts
```

`bunker-plugin.json`
```json
{
  "id": "selam",
  "name": "Selam Botu",
  "version": "0.1.0",
  "description": "!selam yazana cevap verir.",
  "author": "Ad Soyad",
  "sdk": "0.1",
  "permissions": ["events.messages", "chat.send", "storage"]
}
```

`package.json`
```json
{ "name": "@bunker/plugin-selam", "version": "0.1.0", "type": "module", "private": true,
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
    ctx.command("selam", async (c) => {
      const n = ((await ctx.storage.get<number>(`n:${c.uid}`)) ?? 0) + 1;
      await ctx.storage.set(`n:${c.uid}`, n);
      await c.reply(`Selam ${c.nick}! (${n}. kez)`);
    });
  },
});
```

Sonra kökte `npm install`, kökteki `package.json` → `typecheck` betiğine klasörü ekle, `npm run typecheck`.
Bunker'ı yeniden başlat → Yönetim paneli → Sistem → Plugin'ler → aç → sunucu ayarlarından ekle.
Kod Bunker sürecinde çalıştığı için bu yol sadece Bunker ekibinin yazdığı / incelediği plugin'ler içindir.

Dosyalar TypeScript, derleme yok (Node 22 tipleri silip çalıştırır). Bu yüzden `enum`, `namespace`,
parametre özellikleri (`constructor(private x)`) gibi tip silmeyle çalışmayan söz dizimi kullanma; import'larda
`.ts` uzantısını yaz.

---

## Manifest: `bunker-plugin.json`

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `id` | evet* | *Uzak plugin'de yazılmaz (anahtarın plugin'i, `ext-xxxxxxxx`). Küçük harf, rakam, tire; 2-28 karakter, tireyle başlayıp bitmez. **Klasör adıyla aynı olmalı.** Kalıcı kimlik: depo, ayarlar, bot kimliği buna bağlı; sonradan değiştirme. |
| `name` | evet | Görünen ad, ≤40. Mesajlarda botun adı (sunucu yöneticisi sunucusunda değiştirebilir). |
| `version` | evet | `x.y.z` (isteğe bağlı `-beta.1` gibi ek). |
| `sdk` | evet | Uyumlu SDK sürümü: `"0.1"` (bkz. [Sürümler](#sürümler-ve-uyumluluk)). |
| `permissions` | evet | İzin dizisi (boş olabilir). |
| `description` | hayır | ≤300. Store'da ve sunucu ayarlarında görünür. |
| `author` | hayır | ≤80. |
| `main` | hayır | Giriş dosyası, varsayılan `src/index.ts` (sadece Bunker içindeki plugin'ler). |
| `ui` | hayır | Panel penceresi, bkz. [Pencere](#pencere-panel-arayüzü). |

Manifest geçersizse plugin yüklenmez; hatalar yönetim panelinde görünür. Doğrulamayı kendin de yapabilirsin:

```ts
import { validateManifest } from "@bunker-community/plugin-sdk";
const r = validateManifest(JSON.parse(text)); // { ok: true, manifest } | { ok: false, errors: string[] }
```

---

## İzinler

Plugin sadece manifest'te yazdığı izinlerin gerektirdiği şeyleri yapabilir; izinsiz çağrı hata fırlatır.
Sunucu sahibi plugin'i eklerken bu listeyi onaylar. Plugin güncellenip **yeni izin isterse**, o sunucuda yeniden
onaylanana kadar çalışmaz. Gereksiz izin isteme.

| İzin | Sunucu sahibine gösterilen | Açtığı şey |
|---|---|---|
| `events.messages` | Metin kanallarındaki mesajları okur, komutlara cevap verir | `message.*` olayları, `ctx.command` |
| `events.voice` | Ses kanallarına kimin girip çıktığını görür | `voice.*` olayları |
| `events.members` | Sunucuya katılan ve ayrılan üyeleri görür | `member.*`, `guild.create/delete` |
| `events.channels` | Kanalların açılmasını, değişmesini ve silinmesini görür | `channel.*` |
| `events.presence` | Üyelerin çevrimiçi olup olmadığını görür | `user.online/offline` |
| `chat.send` | Metin kanallarına kendi adıyla mesaj yazar | `ctx.chat.send`, `CommandCall.reply` |
| `storage` | Kendi verilerini Bunker'da saklar | `ctx.storage` |
| `voice.speak` | Ses kanallarına katılır ve ses çalar | `ctx.voice` |

`ctx.ui` (pencere) ve `ctx.log` izin gerektirmez.

**Kapsam:** plugin sadece **ekli olduğu sunucuların** olaylarını duyar ve sadece oralara yazar / oradaki ses
kanallarına girer. Özel mesajlar (DM) plugin'lere hiç gönderilmez.

---

## Yaşam döngüsü

```ts
export default definePlugin({
  async setup(ctx) {
    // Plugin açılınca bir kez. Dinleyicileri burada kur.
    ctx.onUnload(async () => {
      // Kapanırken: zamanlayıcıları durdur, gerekiyorsa durumu depoya yaz.
    });
  },
});
```

- `setup` hata fırlatırsa plugin `error` durumuna geçer.
- Plugin kapatılınca (yönetim paneli, sunucu yeniden başlarken, hata bütçesi aşılınca): bütün dinleyiciler
  bırakılır, ses oturumları kapanır, `onUnload` fonksiyonları çalışır. `onUnload` içinde depo hâlâ kullanılabilir.
  Sunucu kapanırken plugin'lere toplam **en fazla 3 sn** tanınır.
- Kapandıktan sonra eski `ctx` ile yapılan her çağrı `"plugin kapalı"` hatası verir; `setTimeout` vb. kendin
  açtığın şeyleri `onUnload`'da temizle.
- Plugin kodu değişince sunucunun yeniden başlatılması gerekir (modül önbelleği).
- **Hata bütçesi:** dinleyicilerinden 60 sn içinde 10 hata çıkarsa plugin kendiliğinden kapanır.

---

## `PluginContext` (ctx)

| Üye | Açıklama |
|---|---|
| `ctx.manifest` | Doğrulanmış manifest (salt okunur). |
| `ctx.log.info/warn/error(msg, ctx?)` | Bunker kayıtlarına `plugin` etiketiyle yazar. |
| `ctx.on(olay, fn)` | Olay dinle; dönen fonksiyon dinlemeyi bırakır. |
| `ctx.command(ad, fn)` | `!ad` komutu. |
| `ctx.chat.send(kanal, metin)` | Metin kanalına mesaj. |
| `ctx.storage` | Kalıcı anahtar-değer deposu. |
| `ctx.voice.join(cid)` / `ctx.voice.session(cid)` | Ses kanalı oturumu. |
| `ctx.ui.setState(where, state, opts?)` / `ctx.ui.onAction(fn)` | Panel penceresi. |
| `ctx.onUnload(fn)` | Kapanışta çalışacak temizlik. |

Bütün olay verileri çekirdekten **kopyadır**; değiştirmen Bunker'ı etkilemez.

---

## Olaylar

```ts
ctx.on("member.join", (e) => ctx.log.info("yeni üye", { gid: e.gid, uid: e.uid }));
```

| Olay | Veri | İzin |
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
| `user.online` / `user.offline` | `{ uid }` (sadece ekli olduğun bir sunucunun üyesiyse) | `events.presence` |
| `guild.install` | `{ gid, by }`: plugin bu sunucuya eklendi | — |
| `guild.uninstall` | `{ gid }`: çıkarıldı ya da sunucu silindi; **o sunucunun verisini burada sil** | — |

```ts
interface PluginMessage {
  id: string; ts: number; uid: string; nick: string;
  text: string;          // ham metin: bahsetme <@uid>, özel emoji <:ad:id> biçiminde
  system: boolean;       // "... sabitledi" gibi sistem satırı
  bot: boolean;          // bot ya da plugin yazdı (kendi mesajların dahil: döngüye girme!)
  attachments: number;   // görsel/video sayısı
  replyTo?: string; edited?: number;
}
```

Olaylar çekirdek işini bitirdikten sonra (ertelenerek) gelir: dinleyicin yavaş olsa da Bunker beklemez,
cevabın kullanıcının mesajından sonra görünür.

---

## Komutlar

```ts
ctx.command("zar", async (c) => {
  const yüz = Number(c.args) || 6;
  await c.reply(`${c.nick} attı: ${1 + Math.floor(Math.random() * yüz)}`);
});
```

- İzin: `events.messages` (cevap için ayrıca `chat.send`).
- Ad: harf, rakam, `_`, `-`; 1-32 karakter; küçük harfe çevrilir; `!` yazılmaz.
- Sadece metin kanallarında, **insan** yazınca tetiklenir (botlar komut çalıştıramaz).
- Bunker'ın kendi komutları (`!play`, `!skip`, `!rank`, `!bug` …) ve başka bir plugin'in aldığı ad alınamaz
  (`setup` hata verir).

```ts
interface CommandCall {
  gid: string; chan: string; uid: string; nick: string;
  args: string;                 // komuttan sonraki metin
  m: PluginMessage;
  reply(text: string): Promise<void>; // aynı kanala
}
```

---

## Mesaj gönderme

```ts
const r = await ctx.chat.send(chanId, "Merhaba!"); // { id } | null
```

- İzin `chat.send`. Sadece ekli olduğun sunucunun metin kanallarına.
- Plugin'in adıyla (sunucuda verilmiş özel adla) ve BOT işaretiyle görünür.
- 10 sn'de en fazla 10 mesaj; fazlası hata.
- Metinde bahsetme `<@uid>` biçiminde yazılır.

---

## Depo

```ts
await ctx.storage.set("ayar:" + gid, { dil: "tr" });
const a = await ctx.storage.get<{ dil: string }>("ayar:" + gid); // yoksa undefined
await ctx.storage.delete("ayar:" + gid);
const anahtarlar = await ctx.storage.keys("ayar:");
```

- İzin `storage`. Plugin'e özel (başka plugin göremez), Bunker'ın veritabanında, yeniden başlatmada kalır.
- Değer JSON'a çevrilebilir olmalı, ≤64 KB. Anahtar 1-200 karakter; plugin başına ≤10 000 anahtar.
- Veri **bütün sunucular için ortak** tek depoda: sunucuya ait veriyi `gid` önekiyle tut, `guild.uninstall`'da sil.

---

## Ses

İzin `voice.speak`. Her ses kanalında ayrı bir oturum (bot kanalda ayrı üye olarak görünür).

```ts
const s = await ctx.voice.join(cid);   // zaten oradaysa aynı oturum
s.setVolume(30);
s.on("started", () => ctx.log.info("çalıyor"));
s.on("ended", () => ctx.log.info("bitti"));
s.on("error", (why, { silent }) => { if (!silent) ctx.log.warn(why); });
s.on("leave", (why) => ctx.log.info("ayrıldı: " + why));
await s.playMedia("daft punk one more time");
```

`ctx.voice.session(cid)` açık oturumu verir (yoksa `null`).

### `VoiceSession`

| Üye | Açıklama |
|---|---|
| `gid`, `cid` | Sunucu ve kanal. |
| `playing`, `paused`, `volume` (0-100), `connected` | Durum (salt okunur). |
| `playMedia(sorgu, { seek? })` | YouTube / SoundCloud bağlantısı, radyo yayını ya da arama metni (YouTube'da aranır, engellenirse SoundCloud). Şarkı bilgisi `meta` olayıyla gelir. |
| `prefetch(sorgu)` | Sıradakini önceden çöz (geçiş hızlansın; 30 dk geçerli). |
| `playUrl(url, { seek? })` | Doğrudan http(s) ses adresi (radyo, mp3…). İç ağ adresleri reddedilir. |
| `playPcm(akış)` | Kendi ürettiğin ses: 48 kHz, stereo, 16 bit little-endian ham PCM, `AsyncIterable<Uint8Array>`. Sadece Bunker içindeki plugin'ler. |
| `stop()`, `pause()`, `resume()` | Yeni bir `play*` çalanı durdurur. |
| `setVolume(v)` | 0-100. |
| `leave()` | Kanaldan çık. |
| `on(olay, fn)` → bırakma fonksiyonu | `started` (ilk ses gitti), `ended` (akış bitti), `error(why, { silent })` (çalınamadı; `silent` = YouTube engeli gibi, kullanıcıya göstermek şart değil), `meta(MediaMeta)`, `leave(why)`. |

```ts
interface MediaMeta { title: string; artist: string; duration: number /* sn, canlıda 0 */; thumb: string; src: string; url: string }
```

- Kanalda insan kalmazsa 60 sn sonra, kanal silinince hemen, plugin sunucudan çıkarılınca / kapanınca
  oturum kapanır (`leave` olayı).
- Bunker genelinde aynı anda en fazla 12 plugin ses oturumu.

---

## Pencere (panel arayüzü)

Plugin, panelin sol altındaki plugin grubunda bir ikon ve tıklayınca açılan bir pencere gösterebilir.

```json
"ui": { "title": "Müzik", "icon": "music", "page": "ui/index.html", "scope": "voice" }
```

| Alan | Açıklama |
|---|---|
| `title` | Pencere başlığı (≤40). |
| `icon` | Panel ikon adı (aşağıda); yoksa `plug`. |
| `page` | Plugin klasöründe `.html` dosyası. |
| `scope` | `"voice"`: sadece o sunucunun bir ses kanalındayken görünür, durum **kanal başına**. `"guild"`: sunucuda her zaman, durum sunucu başına. |

Kullanılabilir ikonlar: `dots copy ticket hash pin volume
mic micOff headphones headphonesOff gear users lock plus chevron x menu send clip moon sun plug radio store
arrowIn arrowOut volumeX ban hand edit trash user info mute rec screen camera moveTo logout shield compass
userPlus check search door music shuffle skip play pause list smile smilePlus reply message maximize gamepad
monitor tv download sleep clock crown live phone phoneOff video bell at keyboard palette key`.

### Model: durum aşağı, işlem yukarı

```
plugin (sunucu)  ── ctx.ui.setState ──▶  panel  ── postMessage {bunker:"state"} ──▶  sayfa (iframe)
plugin (sunucu)  ◀── ctx.ui.onAction ──  panel  ◀── postMessage {bunker:"action"} ──  sayfa
```

Sayfa kendi başına hiçbir yere bağlanamaz; bütün iş plugin'de, sayfa sadece durumu çizer ve tıklamaları iletir.

**Sunucu tarafı**

```ts
ctx.ui.onAction(async (a) => {
  // a: { gid, cid?, uid, nick, name, data }
  if (a.name === "sayac.arttir") {
    const n = ((await ctx.storage.get<number>("n:" + a.gid)) ?? 0) + 1;
    await ctx.storage.set("n:" + a.gid, n);
    ctx.ui.setState({ gid: a.gid }, { n, son: a.nick });
  }
});
```

- `setState({ gid, cid? }, state, { live? })`: o sunucudaki (scope `voice` ise o kanaldaki) herkese anında gider;
  bağlanan kullanıcılar da son durumu alır. JSON, ≤32 KB. `live: true` → sol alttaki ikon yanar (ör. çalarken).
  `null` → temizle. Durum bellekte tutulur, yeniden başlatmada silinir (gerekirse depoya yaz).
- `onAction`: Bunker önce kontrol eder: kişi sunucunun üyesi mi, scope `voice` ise o kanalda mı. Kişi başı
  saniyede ≤10 işlem, `data` ≤4 KB. Yine de `data`'yı **güvenilmez girdi** say ve doğrula.
- Sayfa ilk açıldığında durum yoksa `state: null` gelir; bir `"hello"` işlemi gönderip durumu yayınlamak
  iyi bir alışkanlık.

**Sayfa tarafı (`ui/index.html`)**

```html
<!doctype html>
<meta charset="utf-8">
<style>
  :root { --bg:#1e1f22; --text:#dbdee1; --accent:#6c6cff; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--text); font:14px system-ui; }
  button { background:var(--accent); color:#fff; border:0; border-radius:6px; padding:8px 12px; }
</style>
<p id="t">…</p>
<button id="b">Arttır</button>
<script>
  const act = (name, data) => parent.postMessage({ bunker: "action", name, data }, "*");
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || m?.bunker !== "state") return;
    for (const [k, v] of Object.entries(m.ctx.theme)) if (typeof v === "string") document.documentElement.style.setProperty("--" + k, v);
    if (!m.state) return act("hello");
    document.getElementById("t").textContent = `Sayaç: ${m.state.n} (son: ${m.state.son})`;
  });
  document.getElementById("b").onclick = () => act("sayac.arttir");
  parent.postMessage({ bunker: "ready" }, "*");
</script>
```

Mesajlar:

| Yön | Mesaj |
|---|---|
| sayfa → panel | `{ bunker: "ready" }` (hazırım, durumu yolla) · `{ bunker: "action", name, data? }` · `{ bunker: "close" }` (pencereyi kapat) |
| panel → sayfa | `{ bunker: "state", state, ctx: { gid, cid, me: { uid, nick }, theme: { dark, bg, text, muted, accent, border, hover } } }` |

Sayfanın kuralları:
- `<iframe sandbox="allow-scripts">` içinde, ayrı kökende açılır: panelin çerezlerine, verisine, DOM'una erişemez.
- CSP: ağ isteği yok (`fetch`, WebSocket, form yok); script ve stil satır içi ya da plugin klasöründen,
  yazı tipi `data:` ya da klasörden. Görseller `https:`, `data:` ya da klasörden yüklenebilir (ör. kapak resmi).
  **Tek dosya** önerilir (uzak plugin'de zorunlu).
- Sayfa sadece `ui.page`'in bulunduğu klasörden sunulur (`/plugin-ui/<id>/…`).
- Panelin çevirisi (İngilizce) sayfaya uygulanmaz; `ctx` içinde dil yok, şimdilik metinleri sen seç.
- Tema renklerini `ctx.theme`'den al ki açık/koyu temada uyumlu görünsün.

---

## Bunker'da çalıştırma (barındırma)

Kodunu sürekli açık bir makinede tutamıyorsan Bunker çalıştırabilir. Kod aynıdır; sadece tek dosyaya
paketlenir ve Bunker ekibi inceler.

1. Kodunu **tek bir ESM dosyasına** paketle. `@bunker-community/plugin-sdk` dışında hiçbir import kalmamalı:

```bash
npx esbuild index.js --bundle --format=esm --platform=neutral --external:@bunker-community/plugin-sdk --outfile=bundle.mjs
```

   Dosya `export default definePlugin({ … })` içermeli ve `connect()` **çağırmamalı** (bağlantıyı Bunker kurar).
   Aynı kodu hem kendi bilgisayarında hem Bunker'da çalıştırmak istersen `connect`'i ayrı bir dosyaya koy:

```js
// plugin.js: Bunker'a yüklenen kısım
import { definePlugin } from "@bunker-community/plugin-sdk";
export default definePlugin({ setup(ctx) { /* … */ } });

// local.js: sadece kendi bilgisayarında
import { connect } from "@bunker-community/plugin-sdk";
import plugin from "./plugin.js";
connect(plugin, { token: process.env.BUNKER_TOKEN });
```

2. **Ayarlar → Geliştirici** → plugin'in satırında **Kod yükle**: `bundle.mjs` + `bunker-plugin.json` (+ pencere
   varsa `.html` sayfası) dosyalarını birlikte seç. En fazla 1 MB.
3. Site yöneticisi kodu inceler: **Onaylandı** ya da **Reddedildi** (sebebiyle) görürsün.
4. Onaylanınca **Bunker'da çalıştır**'a bas. Satırda "Bunker'da çalışıyor" yazar. Kendi bilgisayarından aynı
   anahtarla bağlanmak artık reddedilir (kod 4004); **Durdur** deyince yine kendi bilgisayarından bağlanabilirsin.
5. Yeni kod yüklersen, onaylanana kadar **eski onaylı sürüm çalışmaya devam eder**.

Barındırılan kodun kuralları (kısıtlı süreç):

| | |
|---|---|
| Ağ | Yok: `fetch`, `WebSocket`, `http`, `net`, `dns`… kapalı. Dışarıyla tek bağlantı Bunker API'si. |
| Dosya | Sadece kendi dosyası okunur; yazma yok. `fs`, `os`, `child_process`, `worker_threads`, `vm` kapalı. |
| Ortam | Ortam değişkenleri boş; Bunker'ın anahtarları, veritabanı ve dosyaları görünmez. |
| Bellek | 128 MB (aşarsa süreç kapanır ve yeniden açılır). |
| İşlemci | 1 dk ortalaması %60'ı geçerse kapanır; 20 sn cevap vermezse (sonsuz döngü) kapanır. |
| Çökme | Yeniden açılır (2 sn → 60 sn bekleyerek); 10 dk'da 5 kez çökerse durur, satırda sebebi görünür. |
| Kayıt | `console.log` / `console.error` Bunker kayıtlarına düşer (dakikada en fazla 60 satır). |
| Depo | Aynı depo: kendi bilgisayarındayken yazdıkların barındırılınca da durur. |

Ağ gerektiren bir plugin (dış API çağıran hava durumu botu gibi) barındırılamaz; onu kendi makinende çalıştır.

---

## Sınırlar

| Şey | Sınır |
|---|---|
| Sunucu başına plugin | 25 |
| Hata bütçesi | 60 sn'de 10 hata → plugin kapanır |
| `chat.send` | 10 sn'de 10 mesaj |
| Depo değeri / anahtar sayısı / anahtar uzunluğu | 64 KB / 10 000 / 200 |
| Pencere durumu | 32 KB |
| Pencere işlemi | kişi başı sn'de 10, `data` ≤4 KB |
| Ses oturumu (Bunker geneli) | 12 |
| Komut adı | 1-32 karakter |
| Uzak plugin (kişi başı) | 5 |
| Geçit | mesaj ≤320 KB, saniyede ~30 çağrı |
| Barındırılan kod | tek dosya ≤1 MB, 128 MB bellek, %60 işlemci; Bunker genelinde 20 süreç |

---

## Sürümler ve uyumluluk

- SDK sürümü `SDK_VERSION` (şu an `0.1.4`). Manifest'teki `sdk` alanı:
  - `0.x` döneminde ara sürüm de kırıcı sayılır: `"0.1"` → 0.1.x ile çalışır, 0.2 ile çalışmaz.
  - `1.0` sonrası: `"1"` ya da `"1.2"` → aynı ana sürümde, en az o ara sürüm.
- Kural: alanlar **eklenir**, silinmez / yeniden adlandırılmaz. Kırıcı değişiklik ana sürümü artırır.
- Değişiklikler: 0.1.0 olaylar, komutlar, depo, mesaj · 0.1.1 `guild.install/uninstall` · 0.1.2 ses
  (`voice.speak`, `playPcm/playUrl`) + pencere (`ui`) · 0.1.3 `playMedia`, `prefetch`, `meta`, `error.silent` · 0.1.4 uzak plugin (`connect`), barındırma.

---

## Yayınlama ve sunucuya ekleme

**Uzak plugin:**
1. Ayarlar → Geliştirici'de oluştur (kişi başı en fazla 5), kodunu çalıştır.
2. Doğrulanmamışken sadece **senin** sunucu ayarları yetkin olan sunuculara eklenebilir. Store'da sadece sana
   görünür ("Doğrulanmamış" etiketiyle).
3. Herkese açmak için Bunker ekibine haber ver: site yöneticisi inceleyip yönetim panelinden "Sunucu sahipleri
   ekleyebilsin" derse Store'da herkese görünür (doğrulandı).
4. Site yöneticisi kötüye kullanılan plugin'i kapatabilir; o zaman bağlantı kapanır (kod 4003).
5. "Sil": plugin bütün sunuculardan çıkar, deposu silinir.

**Bunker içinde (birinci taraf):**
1. Plugin `plugins/<id>/` olarak repoya eklenir, incelenir, deploy edilir, Bunker yeniden başlatılır.
2. **Site yöneticisi** (Yönetim paneli → Sistem → Plugin'ler): plugin'i açar (yüklensin) ve isterse
   "Sunucu sahipleri ekleyebilsin" der (Store'da listelenir). Yeni plugin kapalı ve listesiz gelir.
3. **Sunucu sahibi / `server.manage` yetkisi olan:** Plugin Store'dan ya da Sunucu ayarları → Plugin'ler'den
   ekler, izinleri onaylar. Bot üye listesinde "Botlar" grubunda görünür, adı sunucuya özel değiştirilebilir.
4. Kayıtlar: Yönetim paneli → Kayıtlar, etiket `plugin`.

Test ipuçları (yerel): `PLUGINS_DIR` ile başka plugin klasörü, `PLUGIN_VOICE_WORKER` ile sahte ses süreci,
`PLUGIN_MEDIA_FAKE=<sn>` ile sahte medya (yt-dlp ve LiveKit gerekmez).

---

## Geçit protokolü (SDK'sız bağlanmak)

SDK Node.js içindir. Başka bir dilde yazmak istersen geçide doğrudan bağlanabilirsin: JSON metin mesajları,
WebSocket `wss://bunker.community/app/api/plugin/gateway`. Mesaj ≤320 KB, saniyede ~30 çağrı (anlık 60).

**1. Tanıtma** (ilk mesaj, 10 sn içinde):
```json
{ "op": "hello", "token": "ext-…", "sdk": "0.1.4", "manifest": { "…": "…" }, "uiPage": "<!doctype html>…" }
```
`manifest` ve `uiPage` isteğe bağlı. Cevap:
```json
{ "op": "ready", "v": 1, "sdk": "0.1.4", "manifest": { "…": "…" }, "guilds": [{ "gid": "…", "name": "…" }] }
```

**2. Çağrı → sonuç:**
```json
{ "op": "call", "id": 7, "method": "chat.send", "args": ["<kanal>", "merhaba"] }
{ "op": "result", "id": 7, "ok": true, "value": { "id": "<mesaj>" } }
{ "op": "result", "id": 7, "ok": false, "error": "Bu kanala yazamazsın (plugin bu sunucuya ekli değil)." }
```

| method | args | value |
|---|---|---|
| `subscribe` / `unsubscribe` | `[olay]` (olay adları + `"ui.action"`) | — |
| `command` / `uncommand` | `[ad]` | — |
| `chat.send` | `[kanal, metin]` | `{ id }` ya da `null` |
| `storage.get` | `[anahtar]` | değer ya da `null` |
| `storage.set` | `[anahtar, değer]` | — |
| `storage.delete` | `[anahtar]` | — |
| `storage.keys` | `[önek]` | `string[]` |
| `ui.setState` | `[{ gid, cid? }, durum, { live? }]` | — |
| `voice.join` / `voice.session` | `[cid]` | oturum durumu (session: yoksa `null`) |
| `voice.call` | `[cid, işlem, argümanlar[]]`; işlem: `playUrl playMedia prefetch stop pause resume setVolume leave` | oturum durumu |
| `log` | `["info" / "warn" / "error", mesaj, ek?]` | — |
| `guilds` | `[]` | `[{ gid, name }]` |
| `ping` | `[]` | `"pong"` |

Oturum durumu: `{ gid, cid, playing, paused, volume, connected }`.

**3. Sunucudan gelenler:**
```json
{ "op": "event", "name": "member.join", "data": { "gid": "…", "uid": "…" } }
{ "op": "event", "name": "ui.action", "data": { "gid": "…", "cid": "…", "uid": "…", "nick": "…", "name": "…", "data": null } }
{ "op": "command", "name": "zar", "call": { "gid": "…", "chan": "…", "uid": "…", "nick": "…", "args": "20", "m": { "…": "…" } } }
{ "op": "voice", "cid": "…", "ev": "started", "args": [], "state": { "…": "…" } }
```
`voice.ev`: `started`, `ended`, `error`, `meta`, `leave`. Komuta cevap vermek için `chat.send` ile `call.chan`'a yaz.

**Kapanış kodları:** 4001 anahtar geçersiz / yenilendi · 4002 bozuk mesaj · 4003 plugin kapalı ya da silindi ·
4004 aynı anahtarla yeni bağlantı açıldı (ya da plugin Bunker'da barındırılıyor) · 4005 manifest geçersiz (sebep `reason`'da) · 4008 çok hızlı ya da
mesajları okumuyor. Diğer kopmalarda yeniden bağlan. Bağlantı koptuğunda abonelikler ve komutlar silinir;
yeniden bağlanınca tekrar gönder.

---

## Örnekler

- [`plugins/hello`](https://github.com/bunker-community/plugin-sdk/tree/main/examples/hello): komut, olay, depo, mesaj.
- [`plugins/radio`](https://github.com/bunker-community/plugin-sdk/tree/main/examples/radio): ses (`playUrl`) + pencere.
- [`plugins/music`](https://github.com/bunker-community/plugin-sdk/tree/main/examples/music): kanal başına sıra, `playMedia` + `prefetch`, pencere, yeniden
  başlatmada kaldığı yerden devam (`onUnload` + depo).
