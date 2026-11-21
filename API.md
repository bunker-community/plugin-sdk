# Bunker Plugin Geliştirme Rehberi ve API Referansı

SDK `@bunker-community/plugin-sdk` 0.1.4 · [English](API.en.md)

Bu belge Bunker'a plugin (bot) yazmak isteyenler içindir: ne zorunlu, nasıl yüklenir, hangi fonksiyonlar var.

## İçindekiler
1. [Plugin nedir, nasıl çalışır](#plugin-nedir-nasıl-çalışır)
2. [Zorunlu kurallar](#zorunlu-kurallar)
3. [İlk plugin: yaz, yükle, çalışsın](#ilk-plugin-yaz-yükle-çalışsın)
4. [Geliştirirken test: kendi bilgisayarından bağlanmak](#geliştirirken-test-kendi-bilgisayarından-bağlanmak)
5. [Yaşam döngüsü](#yaşam-döngüsü)
6. [API referansı](#api-referansı)
7. [Store'da yayınlama](#storeda-yayınlama)
8. [Sınırlar ve hata mesajları](#sınırlar-ve-hata-mesajları)
9. [Sık sorulanlar](#sık-sorulanlar)
10. [Ek A: Geçit protokolü (başka dillerde yazmak)](#ek-a-geçit-protokolü-başka-dillerde-yazmak)
11. [Ek B: Sürümler](#ek-b-sürümler)

---

## Plugin nedir, nasıl çalışır

Plugin, Bunker sunucularına eklenen küçük bir programdır: komutlara cevap verir, olayları dinler (mesaj, ses kanalı,
üye), veri saklar, ses kanalında müzik/radyo çalar, panelde kendi penceresini gösterir.

```
  sen ── kodu yüklersin ──▶  Bunker (kısıtlı ortam)  ──▶  plugin'i eklediğin sunucular
                                     │
                                     └─ sadece SDK'nın verdiği işlemler (izin verdiklerin)
```

- Kod **Bunker'da**, her plugin için ayrı ve kısıtlı bir ortamda çalışır. İnternete ve dosyalara erişemez;
  dışarıyla tek bağlantısı SDK'dır.
- Plugin **sadece eklendiği sunucularda** çalışır ve sadece o sunucuların olaylarını görür. Özel mesajları (DM)
  hiçbir zaman görmez.
- Sunucu sahibi plugin'i eklerken istediği **izinleri** görür ve onaylar.
- Yeni plugin **doğrulanmamıştır**: sadece senin yönettiğin sunuculara eklenebilir, kod yükler yüklemez çalışır.
  Herkese açmak için Bunker ekibine incelettirirsin ([Store'da yayınlama](#storeda-yayınlama)).

---

## Zorunlu kurallar

Yüklediğin plugin bu kurallara uymazsa reddedilir ya da çalışmaz.

### Dosyalar

| Dosya | Zorunlu | Açıklama |
|---|---|---|
| `bunker-plugin.json` | evet | Manifest: ad, sürüm, izinler (aşağıda). |
| Kod dosyası (`.mjs` / `.js`) | evet | **Tek dosya**, ES modülü, ≤1 MB. |
| Pencere sayfası (`.html`) | sadece manifest'te `ui` varsa | Tek dosya; script ve stil satır içi. |

### Manifest: `bunker-plugin.json`

```json
{
  "name": "Zar Botu",
  "version": "1.0.0",
  "description": "Zar atar: !zar 20",
  "sdk": "0.1",
  "permissions": ["events.messages", "chat.send"]
}
```

| Alan | Zorunlu | Kural |
|---|---|---|
| `name` | evet | Görünen ad, en fazla 40 karakter. Mesajlarda botun adı olur (sunucu yöneticisi kendi sunucusunda değiştirebilir). |
| `version` | evet | `x.y.z` (ör. `1.0.0`, `1.2.0-beta.1`). |
| `sdk` | evet | `"0.1"`. |
| `permissions` | evet | İzin listesi; izin istemiyorsan `[]`. |
| `description` | hayır | En fazla 300 karakter; Store'da ve sunucu ayarlarında görünür. |
| `author` | hayır | En fazla 80 karakter. |
| `ui` | hayır | Panel penceresi ([Pencere](#pencere-ctxui)). |
| `id` | — | Yazma: plugin'in kimliği (`ext-xxxxxxxx`) Bunker'da oluştururken verilir. |

### Kod

- **Tek dosya.** Başka dosya import edemezsin; kullandığın kütüphaneleri paketleyip tek dosyaya koy
  ([İlk plugin](#ilk-plugin-yaz-yükle-çalışsın), 2. adım).
- Dosya `export default definePlugin({ setup(ctx) { … } })` döndürmeli.
- Dışarıdan tek import: `@bunker-community/plugin-sdk`.
- `connect()` **çağırma**; bağlantıyı Bunker kurar (connect sadece [kendi bilgisayarında test](#geliştirirken-test-kendi-bilgisayarından-bağlanmak) içindir).

### Ortamın yasakları

| Yasak | Açıklama |
|---|---|
| İnternet | `fetch`, `WebSocket`, `http`, `https`, `net`, `dns`… yok. Dış bir API'ye istek atamazsın. |
| Dosya sistemi | `fs`, `os`, `child_process`, `worker_threads`, `vm` yok. Kalıcı veri için [Depo](#depo-ctxstorage) kullan. |
| Ortam değişkenleri | Boş. Gizli anahtar koyacak yer yok (zaten internete çıkamazsın). |
| Kaynak | 128 MB bellek; 1 dk ortalaması %40 işlemciyi geçerse ya da 20 sn cevap vermezse (sonsuz döngü) plugin kapatılıp yeniden başlatılır. 10 dk'da 5 kez çökerse durur. |

İnternet gerektiren bir plugin (hava durumu, döviz…) şimdilik sadece [kendi bilgisayarında](#geliştirirken-test-kendi-bilgisayarından-bağlanmak) çalışabilir.

### İzinler

Sadece ihtiyacın olanı iste; fazla izin isteyen plugin'i sunucu sahipleri eklemez, Store incelemesinde reddedilir.
İzinsiz bir işlem hata fırlatır.

| İzin | Sunucu sahibine gösterilen | Açtığı işlemler |
|---|---|---|
| `events.messages` | Metin kanallarındaki mesajları okur, komutlara cevap verir | `message.*` olayları, `ctx.command` |
| `chat.send` | Metin kanallarına kendi adıyla mesaj yazar | `ctx.chat.send`, `c.reply` |
| `storage` | Kendi verilerini Bunker'da saklar | `ctx.storage` |
| `voice.speak` | Ses kanallarına katılır ve ses çalar | `ctx.voice` |
| `events.voice` | Ses kanallarına kimin girip çıktığını görür | `voice.*` olayları |
| `events.members` | Sunucuya katılan ve ayrılan üyeleri görür | `member.*`, `guild.create/delete` |
| `events.channels` | Kanalların açılmasını, değişmesini ve silinmesini görür | `channel.*` |
| `events.presence` | Üyelerin çevrimiçi olup olmadığını görür | `user.online/offline` |

`ctx.log`, `ctx.ui` ve `guild.install/uninstall` olayları izin istemez. Güncellemede **yeni izin eklersen**, plugin
eklendiği her sunucuda sahibi yeniden onaylayana kadar o sunucuda durur.

---

## İlk plugin: yaz, yükle, çalışsın

**1. İki dosya yaz.**

`bunker-plugin.json`
```json
{
  "name": "Zar Botu",
  "version": "1.0.0",
  "description": "Zar atar: !zar 20",
  "sdk": "0.1",
  "permissions": ["events.messages", "chat.send"]
}
```

`plugin.js`
```js
import { definePlugin } from "@bunker-community/plugin-sdk";

export default definePlugin({
  setup(ctx) {
    ctx.command("zar", async (c) => {
      const yüz = Math.max(2, Math.min(1000, Number(c.args) || 6));
      await c.reply(`${c.nick} attı: ${1 + Math.floor(Math.random() * yüz)} (d${yüz})`);
    });
  },
});
```

**2. Tek dosyaya paketle.** Hiç kütüphane kullanmıyorsan `plugin.js` zaten tek dosyadır, bu adımı atla.
Kullanıyorsan (Node.js 22+):

```bash
npm install @bunker-community/plugin-sdk
npx esbuild plugin.js --bundle --format=esm --platform=neutral --external:@bunker-community/plugin-sdk --outfile=bundle.mjs
```

**3. Bunker'da oluştur ve yükle.**
1. **Ayarlar → Geliştirici → Yeni plugin**: ad yaz, **Oluştur**. (Çıkan anahtarı sakla; sadece kendi
   bilgisayarından test için gerekir.)
2. Plugin'in satırında **Kod yükle**: kod dosyasını ve `bunker-plugin.json`'u (pencere varsa `.html`'i de)
   birlikte seç.
3. **Bunker'da çalıştır**. Satırda "Bağlı (Bunker'da çalışıyor)" yazar.

**4. Sunucuna ekle.** Kendi sunucunda **Sunucu ayarları → Plugin'ler** (ya da Plugin Store) → **Ekle** →
izinleri onayla. Kanala `!zar 20` yaz.

Kodu değiştirince yeniden paketle ve **Yeni kod yükle**: yeni kod hemen devreye girer.

---

## Geliştirirken test: kendi bilgisayarından bağlanmak

Her değişiklikte yüklemek yerine kodu kendi bilgisayarında çalıştırıp Bunker'a bağlayabilirsin. Plugin aynı
sunucularda, aynı izinlerle çalışır; sadece kod senin makinende koşar (internete de çıkabilir).

```bash
npm install @bunker-community/plugin-sdk
```

`local.js` (`package.json`'da `"type": "module"` olmalı)
```js
import { connect } from "@bunker-community/plugin-sdk";
import plugin from "./plugin.js";

connect(plugin, { token: process.env.BUNKER_TOKEN });
```

```bash
BUNKER_TOKEN=<anahtar> node local.js
# PowerShell: $env:BUNKER_TOKEN="<anahtar>"; node local.js
```

- Anahtar Ayarlar → Geliştirici'de plugin'i oluşturunca **bir kez** gösterilir; kaybedersen **Anahtarı yenile**.
  Koda yazma, kimseyle paylaşma.
- `connect`, klasördeki `bunker-plugin.json`'u ve pencere sayfasını her bağlanışta Bunker'a gönderir.
- Plugin Bunker'da çalışırken kendi bilgisayarından bağlanılamaz (kod 4004); önce satırdaki **Durdur**'a bas.
- Kodun kapalıyken bot çevrimdışı görünür, komutlara cevap gelmez.

### `connect(plugin, seçenekler)`

| Seçenek | Açıklama |
|---|---|
| `token` | Zorunlu. Plugin'in anahtarı. |
| `url` | Geçit adresi; varsayılan `wss://bunker.community/app/api/plugin/gateway`. |
| `manifest` | Manifest nesnesi; verilmezse `dir`'deki `bunker-plugin.json` okunur. |
| `dir` | `bunker-plugin.json` ve pencere sayfasının klasörü (varsayılan: çalışma klasörü). |
| `uiPage` | Pencere sayfasının HTML'i (verilmezse `ui.page` dosyası okunur). |
| `logger` | Bağlantı kayıtları (varsayılan `console`). |

Döner: `{ ready: Promise<void>, connected: boolean, close(): Promise<void> }`. Koparsa kendiliğinden yeniden bağlanır
(1 sn → 30 sn). Anahtar geçersiz, plugin kapatılmış, manifest geçersiz ya da plugin Bunker'da çalışıyorsa yeniden
denemez ve `ready` hata verir. Bu yolda ses kanalına ham PCM gönderilemez (`playPcm` yok); `playMedia` ve `playUrl` var.

---

## Yaşam döngüsü

```js
export default definePlugin({
  async setup(ctx) {
    // Plugin başlayınca bir kez: komutları, dinleyicileri burada kur.
    ctx.onUnload(async () => {
      // Kapanırken: zamanlayıcıları durdur, gerekiyorsa durumu depoya yaz.
    });
  },
});
```

- `setup` hata fırlatırsa plugin başlamaz (Ayarlar → Geliştirici'de sebebi görünür).
- Plugin kapanınca (durdurma, yeni kod, Bunker'ın yeniden başlaması): dinleyiciler bırakılır, ses oturumları kapanır,
  `onUnload` çalışır. `onUnload` içinde depo hâlâ kullanılabilir; toplam en fazla 3 sn.
- **Hata bütçesi:** dinleyicilerin 60 sn içinde 10 hata fırlatırsa plugin kendiliğinden durur. Hataları yakala.
- Plugin durunca eski `ctx` ile yapılan her çağrı `plugin kapalı` hatası verir.

---

## API referansı

### `definePlugin(tanım)`

```ts
definePlugin({ setup(ctx: PluginContext): void | Promise<void> }): PluginDefinition
```
Tanımı olduğu gibi döndürür (tip yardımcısı). Kod dosyasının `export default`'u budur.

### `PluginContext` (ctx)

| Üye | İzin | Açıklama |
|---|---|---|
| `ctx.manifest` | — | Doğrulanmış manifest (salt okunur). |
| `ctx.log.info/warn/error(mesaj, ek?)` | — | Kayıt (Ayarlar → Geliştirici'deki hata satırı ve Bunker kayıtları). |
| `ctx.on(olay, fn)` | olaya göre | Olay dinle; dönen fonksiyon dinlemeyi bırakır. |
| `ctx.command(ad, fn)` | `events.messages` | `!ad` komutu; dönen fonksiyon bırakır. |
| `ctx.chat.send(kanal, metin)` | `chat.send` | Metin kanalına mesaj. |
| `ctx.storage` | `storage` | Kalıcı anahtar-değer deposu. |
| `ctx.voice.join(cid)` / `ctx.voice.session(cid)` | `voice.speak` | Ses kanalı oturumu. |
| `ctx.ui.setState(...)` / `ctx.ui.onAction(fn)` | — (manifest `ui`) | Panel penceresi. |
| `ctx.onUnload(fn)` | — | Kapanışta çalışacak temizlik. |

Olay verileri kopyadır; değiştirmen Bunker'ı etkilemez.

### Olaylar: `ctx.on(olay, fn)`

```js
ctx.on("member.join", (e) => ctx.log.info("yeni üye", { gid: e.gid, uid: e.uid }));
```

| Olay | Veri | İzin |
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
| `user.online` / `user.offline` | `{ uid }` (eklendiğin bir sunucunun üyesiyse) | `events.presence` |
| `guild.install` | `{ gid, by }`: plugin bu sunucuya eklendi | — |
| `guild.uninstall` | `{ gid }`: çıkarıldı ya da sunucu silindi; **o sunucunun verisini burada sil** | — |

```ts
interface PluginMessage {
  id: string; ts: number; uid: string; nick: string;
  text: string;         // ham metin: bahsetme <@uid>, özel emoji <:ad:id>
  system: boolean;      // "… sabitledi" gibi sistem satırı
  bot: boolean;         // bot/plugin yazdı (kendi mesajların dahil: cevap döngüsüne girme)
  attachments: number;  // görsel/video sayısı
  replyTo?: string; edited?: number;
}
```

Olaylar Bunker işini bitirdikten sonra gelir; yavaş bir dinleyici Bunker'ı bekletmez.

### Komutlar: `ctx.command(ad, fn)`

```js
ctx.command("selam", (c) => c.reply(`Selam ${c.nick}!`));
```

- Ad: harf, rakam, `_`, `-`; 1-32 karakter; `!` yazılmaz; küçük harfe çevrilir.
- Sadece metin kanallarında ve **insan** yazınca tetiklenir.
- Bunker'ın kendi komutları (`!play`, `!skip`, `!rank`, `!bug`…) ve başka plugin'in aldığı ad alınamaz.

```ts
interface CommandCall {
  gid: string; chan: string; uid: string; nick: string;
  args: string;                        // komuttan sonraki metin
  m: PluginMessage;
  reply(metin: string): Promise<void>; // aynı kanala (chat.send izni gerekir)
}
```

### Mesaj: `ctx.chat.send(kanal, metin)`

```js
const r = await ctx.chat.send(chanId, "Merhaba!"); // { id } | null
```
Sadece eklendiğin sunucuların metin kanallarına; botun adıyla ve BOT işaretiyle görünür. 10 sn'de en fazla 10 mesaj.
Metin en fazla 1800 karakter (fazlası kesilir). Bahsetme: `<@uid>`.

### Depo: `ctx.storage`

```js
await ctx.storage.set("ayar:" + gid, { dil: "tr" });
const a = await ctx.storage.get("ayar:" + gid);   // yoksa undefined
await ctx.storage.delete("ayar:" + gid);
const anahtarlar = await ctx.storage.keys("ayar:");
```

| Fonksiyon | Döner |
|---|---|
| `get(anahtar)` | değer ya da `undefined` |
| `set(anahtar, değer)` | — (değer JSON'a çevrilebilir olmalı) |
| `delete(anahtar)` | — |
| `keys(önek?)` | `string[]` |

Plugin'e özel, kalıcı. Değer ≤64 KB, anahtar 1-200 karakter, en fazla 10 000 anahtar. Bütün sunucular için
**tek depo**: sunucuya ait veriyi `gid` önekiyle tut, `guild.uninstall`'da sil.

### Ses: `ctx.voice`

```js
const s = await ctx.voice.join(cid);     // zaten oradaysa aynı oturum
s.setVolume(30);
s.on("meta", (m) => ctx.log.info("çalıyor: " + m.title));
s.on("error", (why, { silent }) => { if (!silent) ctx.log.warn(why); });
await s.playMedia("daft punk one more time");
```

`ctx.voice.session(cid)` açık oturumu verir (yoksa `null`). Bot kanalda ayrı bir üye olarak görünür.

| `VoiceSession` | Açıklama |
|---|---|
| `gid`, `cid`, `playing`, `paused`, `volume` (0-100), `connected` | Durum (salt okunur). |
| `playMedia(sorgu, { seek? })` | YouTube / SoundCloud bağlantısı, radyo yayını ya da arama metni. Bilgi `meta` olayıyla gelir. |
| `prefetch(sorgu)` | Sıradakini önceden hazırla (geçiş hızlanır; 30 dk geçerli). |
| `playUrl(url, { seek? })` | Doğrudan http(s) ses adresi (radyo, mp3). |
| `stop()`, `pause()`, `resume()`, `setVolume(v)` | Kontrol. |
| `leave()` | Kanaldan çık. |
| `on(olay, fn)` | `started`, `ended`, `error(why, { silent })`, `meta(MediaMeta)`, `leave(why)`; dönen fonksiyon bırakır. |

```ts
interface MediaMeta { title: string; artist: string; duration: number /* sn, canlıda 0 */; thumb: string; src: string; url: string }
```
`error` olayında `silent: true` ise (ör. YouTube engeli) kullanıcıya göstermen gerekmez. Kanalda kimse kalmazsa
60 sn sonra, kanal silinince hemen oturum kapanır (`leave`). Bunker genelinde aynı anda en fazla 12 plugin ses oturumu.

### Pencere: `ctx.ui`

Plugin, panelin sol altındaki plugin grubunda bir ikon ve tıklayınca açılan bir pencere gösterebilir.

```json
"ui": { "title": "Zar", "icon": "gamepad", "page": "ui.html", "scope": "guild" }
```

| Alan | Açıklama |
|---|---|
| `title` | Pencere başlığı (≤40). |
| `icon` | İkon adı (aşağıda); yoksa `plug`. |
| `page` | Pencere sayfası `.html` (yüklerken bu dosyayı da seç). |
| `scope` | `"guild"`: sunucuda her zaman görünür, durum sunucu başına. `"voice"`: sadece o sunucunun bir ses kanalındayken, durum **kanal başına**. |

İkonlar: `music radio tv gamepad play pause skip shuffle list volume mic headphones monitor screen camera video live
clock bell crown smile message hash pin users user gear plug store compass shield key palette keyboard search check
info edit trash download sleep phone at`.

**Model: durum aşağı, işlem yukarı.** Sayfa kendi başına hiçbir yere bağlanamaz; bütün iş plugin'de olur.

```
plugin ── ctx.ui.setState ──▶ panel ── {bunker:"state"} ──▶ sayfa
plugin ◀── ctx.ui.onAction ── panel ◀── {bunker:"action"} ── sayfa
```

| Fonksiyon | Açıklama |
|---|---|
| `ctx.ui.setState({ gid, cid? }, durum, { live? })` | Durumu o sunucudakilere (scope `voice` ise o kanaldakilere) gönderir; sonradan açanlar da son durumu alır. JSON, ≤32 KB. `live: true` → ikon yanar. `null` → temizle. Bellekte tutulur. |
| `ctx.ui.onAction(fn)` | `fn({ gid, cid?, uid, nick, name, data })`. Bunker kişinin üye (ve scope `voice` ise kanalda) olduğunu denetler; kişi başı sn'de ≤10, `data` ≤4 KB. Yine de `data`'yı doğrula. |

```js
ctx.ui.onAction(async (a) => {
  if (a.name === "at") ctx.ui.setState({ gid: a.gid }, { son: a.nick, sonuç: 1 + Math.floor(Math.random() * 6) });
});
```

Sayfa (`ui.html`):
```html
<!doctype html>
<meta charset="utf-8">
<style>
  :root { --bg:#1e1f22; --text:#dbdee1; --accent:#6c6cff; }
  body { margin:0; padding:16px; background:var(--bg); color:var(--text); font:14px system-ui; }
  button { background:var(--accent); color:#fff; border:0; border-radius:6px; padding:8px 12px; }
</style>
<p id="t">…</p>
<button id="b">Zar at</button>
<script>
  const act = (name, data) => parent.postMessage({ bunker: "action", name, data }, "*");
  addEventListener("message", (e) => {
    const m = e.data;
    if (e.source !== parent || m?.bunker !== "state") return;
    for (const [k, v] of Object.entries(m.ctx.theme)) if (typeof v === "string") document.documentElement.style.setProperty("--" + k, v);
    document.getElementById("t").textContent = m.state ? `${m.state.son}: ${m.state.sonuç}` : "Henüz atılmadı";
  });
  document.getElementById("b").onclick = () => act("at");
  parent.postMessage({ bunker: "ready" }, "*");
</script>
```

| Yön | Mesaj |
|---|---|
| sayfa → panel | `{ bunker: "ready" }` · `{ bunker: "action", name, data? }` · `{ bunker: "close" }` |
| panel → sayfa | `{ bunker: "state", state, ctx: { gid, cid, me: { uid, nick }, theme: { dark, bg, text, muted, accent, border, hover } } }` |

Sayfa kuralları: izole çerçevede açılır (panelin çerezine/verisine erişemez); ağ isteği yok; tek dosya, script ve stil
satır içi; görseller `https:` ya da `data:` olabilir; renkleri `ctx.theme`'den al.

---

## Store'da yayınlama

Doğrulanmamış plugin sadece senin sunucularında çalışır ve Store'da sadece sana görünür ("Doğrulanmamış" etiketiyle).
Herkesin ekleyebilmesi için:

1. Plugin'i kendi sunucunda düzgün çalışır hale getir.
2. Bunker ekibine haber ver (support@bunker.community): plugin'in adı ve kimliği (`ext-…`).
3. Ekip kodu inceler. Onaylanırsa Store'da herkese görünür (doğrulandı).

İnceleme şunlara bakar: istenen izinler gerçekten gerekli mi, açıklama doğru mu, kullanıcıyı yanıltan / taciz eden /
spam yapan davranış var mı, kod okunabilir mi (bilerek gizlenmiş kod reddedilir).

Store'a alındıktan sonra **yüklediğin her yeni kod da incelenir**; onaylanana kadar eski onaylı sürüm çalışmaya
devam eder. Kötüye kullanılan plugin kapatılır.

---

## Sınırlar ve hata mesajları

| Şey | Sınır |
|---|---|
| Kod dosyası | tek dosya, ≤1 MB |
| Bellek / işlemci | 128 MB / 1 dk ortalama %40 |
| Kişi başı plugin | 5 |
| Sunucu başı plugin | 25 |
| Hata bütçesi | 60 sn'de 10 hata → plugin durur |
| `chat.send` | 10 sn'de 10 mesaj, ≤1800 karakter |
| Depo | değer ≤64 KB, ≤10 000 anahtar, anahtar ≤200 karakter |
| Pencere | durum ≤32 KB; işlem kişi başı sn'de 10, `data` ≤4 KB |
| Ses | Bunker genelinde 12 oturum |
| Komut adı | 1-32 karakter |

Sık görülen hatalar:

| Hata | Sebep |
|---|---|
| `… için "X" izni gerekli` | Manifest'e o izni eklemedin. |
| `Bu kanala yazamazsın (plugin bu sunucuya ekli değil).` | Kanal, plugin'in eklenmediği bir sunucuda. |
| `Çok hızlı: 10 sn'de en fazla 10 mesaj` | Mesaj sınırı. |
| `!x Bunker'ın kendi komutu, alınamaz` / `başka bir plugin'de kayıtlı` | Komut adını değiştir. |
| `değer en fazla 64 KB` / `durum en fazla 32 KB` | Veriyi böl. |
| `plugin kapalı` | Plugin durduktan sonra eski `ctx` kullanıldı (zamanlayıcıyı `onUnload`'da durdur). |
| `Bunker'da barındırılan plugin bunu kullanamaz: …` | Yasak modül/işlem (internet, dosya…). |

---

## Sık sorulanlar

**Plugin'im cevap vermiyor.** Ayarlar → Geliştirici'de satır "Bağlı" mı? Sunucu ayarları → Plugin'ler'de plugin ekli
mi, "Yeni izin istiyor" uyarısı var mı? Komut adı doğru mu? Hata satırında sebep yazar.

**Dış bir API'ye istek atmam lazım.** Bunker'da çalışan kod internete çıkamaz. Kodu kendi bilgisayarında / sunucunda
`connect` ile çalıştır ([test bölümü](#geliştirirken-test-kendi-bilgisayarından-bağlanmak)); bu şekilde kalıcı da çalışabilir.

**TypeScript kullanabilir miyim?** Evet; paketlerken esbuild TypeScript'i de çevirir. Tipler pakette var
(`import type { PluginContext } from "@bunker-community/plugin-sdk"`).

**Kullanıcı başına ayar nasıl saklarım?** Anahtara sunucu ve kişi kimliğini koy: `ctx.storage.set("ayar:" + gid + ":" + uid, …)`.

**Anahtarımı kaybettim / sızdı.** Ayarlar → Geliştirici → **Anahtarı yenile**; eskisi hemen geçersiz olur.

---

## Ek A: Geçit protokolü (başka dillerde yazmak)

SDK Node.js içindir. Başka bir dilde (Python, Go…) kendi makinende çalışacak bir bot yazmak istersen geçide doğrudan
bağlan: WebSocket `wss://bunker.community/app/api/plugin/gateway`, JSON metin mesajları, mesaj ≤320 KB, saniyede ~30 çağrı.

**Tanıtma** (ilk mesaj, 10 sn içinde) ve cevabı:
```json
{ "op": "hello", "token": "ext-…", "sdk": "0.1.4", "manifest": { "name": "…", "version": "1.0.0", "sdk": "0.1", "permissions": [] }, "uiPage": "<!doctype html>…" }
{ "op": "ready", "v": 1, "sdk": "0.1.4", "manifest": { "…": "…" }, "guilds": [{ "gid": "…", "name": "…" }] }
```

**Çağrı → sonuç:**
```json
{ "op": "call", "id": 7, "method": "chat.send", "args": ["<kanal>", "merhaba"] }
{ "op": "result", "id": 7, "ok": true, "value": { "id": "<mesaj>" } }
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
| `voice.join` / `voice.session` | `[cid]` | oturum durumu |
| `voice.call` | `[cid, işlem, argümanlar[]]` (`playUrl playMedia prefetch stop pause resume setVolume leave`) | oturum durumu |
| `log` | `["info" / "warn" / "error", mesaj, ek?]` | — |
| `guilds` | `[]` | `[{ gid, name }]` |

Oturum durumu: `{ gid, cid, playing, paused, volume, connected }`.

**Sunucudan gelenler:**
```json
{ "op": "event", "name": "member.join", "data": { "gid": "…", "uid": "…" } }
{ "op": "command", "name": "zar", "call": { "gid": "…", "chan": "…", "uid": "…", "nick": "…", "args": "20", "m": { "…": "…" } } }
{ "op": "voice", "cid": "…", "ev": "started", "args": [], "state": { "…": "…" } }
```
Komuta cevap: `chat.send` ile `call.chan`'a. Bağlantı koparsa abonelikler silinir; yeniden bağlanınca tekrar gönder.

**Kapanış kodları:** 4001 anahtar geçersiz/yenilendi · 4002 bozuk mesaj · 4003 plugin kapatıldı/silindi · 4004 aynı
anahtarla başka bağlantı ya da plugin Bunker'da çalışıyor · 4005 manifest geçersiz (sebep `reason`'da) · 4008 çok
hızlı ya da mesajları okumuyor. Diğerlerinde yeniden bağlan.

---

## Ek B: Sürümler

Manifest'teki `sdk: "0.1"` → 0.1.x ile çalışır. Alanlar eklenir, silinmez; kırıcı değişiklikte sürüm numarası artar.

| Sürüm | Değişiklik |
|---|---|
| 0.1.4 | Plugin'i Bunker'a yükleme (barındırma), kendi bilgisayarından bağlanma (`connect`) |
| 0.1.3 | `playMedia`, `prefetch`, `meta` olayı, `error` olayında `silent` |
| 0.1.2 | Ses (`voice.speak`) ve panel penceresi (`ui`) |
| 0.1.1 | `guild.install` / `guild.uninstall` olayları |
| 0.1.0 | Olaylar, komutlar, depo, mesaj |

Örnekler: [github.com/bunker-community/plugin-sdk/tree/main/examples](https://github.com/bunker-community/plugin-sdk/tree/main/examples)
