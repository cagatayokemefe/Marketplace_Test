# MeetApp — etkinlik bul, katıl, öde

*[English version →](README.md)*

Meetup benzeri bir etkinlik uygulaması. Biri voleybol maçı açar, katılmak isteyen
kişi uygulamadan yerini ayırtır, katılım ücretini uygulama üzerinden öder ve
girişte gösterebileceği bir bilet alır. **Para ödeme anında otomatik bölünür**:
organizatörün payı doğrudan kendi hesabına, komisyon uygulama sahibine geçer.

Tek bir kod tabanı üç yerde çalışır:

| Nerede | Nasıl |
| --- | --- |
| **Web (masaüstü)** | Tarayıcıda `http://localhost:3000` |
| **Telefon — uygulama gibi** | PWA: Safari/Chrome'da "Ana Ekrana Ekle" → tam ekran, ikonlu, çevrimdışı açılan uygulama |
| **Native iOS / Android** | Capacitor ile App Store / Play Store paketi (`capacitor.config.json` hazır) |

Arayüz mobil öncelikli tasarlandı: telefonda alt sekme çubuğu ve sabit ödeme
butonu, masaüstünde üst menü ve iki sütunlu detay sayfası kullanılır. Açık/koyu
tema ve **Türkçe / İngilizce dil desteği** vardır.

---

## Hızlı başlangıç

```bash
cd event-app
npm install
npm start
```

`http://localhost:3000` adresini aç. Veritabanı boşsa demo verisi (voleybol,
halı saha, yoga, doğa yürüyüşü etkinlikleri) otomatik yüklenir.

### Hazır hesaplar

| Hesap | E-posta | Şifre | Ne görür |
| --- | --- | --- | --- |
| Katılımcı | `irfan@example.com` | `irfan1234` | Etkinliklere katılır, öder, bilet alır |
| Organizatör | `zeynep@example.com` | `zeynep1234` | Kendi etkinliklerinin katılımcı listesi + giriş kontrolü |
| **Uygulama sahibi** | `owner@meetapp.app` | `owner1234` | Gelir paneli: tahsilat, komisyon, otomatik giden pay ve kalan borç |

### Dil

Üst çubuktaki **TR / EN** düğmesinden ya da Profil sayfasındaki dil bölümünden
anında değiştirilir. Detaylar için aşağıdaki [Dil desteği](#dil-desteği)
bölümüne bak.

Yararlı komutlar:

```bash
npm run seed     # demo verisini ekler (var olanı bozmaz)
npm run reset    # veritabanını temizleyip demo veriyi baştan kurar
npm run smoke    # uçtan uca duman testi (geçici veritabanıyla)
npm run icons    # uygulama ikonlarını yeniden üretir
```

---

## Senaryo: İrfan voleybola katılıyor

1. **Keşfet** — İrfan uygulamayı açar, "voleybol" arar ya da Spor/İstanbul
   filtrelerini seçer. Kartta tarih, mekân, doluluk (1/12) ve ücret (₺150) görünür.
2. **Detay** — Etkinliğe girer; açıklama, adres, organizatör ve katılanlar listelenir.
   Ekranın altında sabit duran çubukta "₺150 · kişi başı" ve **Katıl ve öde** vardır.
3. **Yer ayırma** — Butona basınca sunucu kontenjanı kontrol eder, `pending`
   durumunda bir kayıt ve bir ödeme kaydı açar.
4. **Ödeme** — Kart ekranında tutar ve etkinlik özeti görünür. Ödeme onaylanınca
   kayıt `confirmed` olur; organizatörün payı kendi hesabına, komisyon sahibe geçer.
5. **Bilet** — İrfan'a `ABCD-1234` biçiminde bir giriş kodu verilir. Salonda
   organizatör bu kodu **Katılımcılar → Giriş kontrolü** ekranına yazıp doğrular;
   aynı kod ikinci kez kabul edilmez.
6. **İptal** — Etkinliğe 6 saatten fazla varsa İrfan iptal edebilir, ücret iade edilir.
   Son 6 saatte iade kapalıdır.

---

## Para nasıl akıyor?

İki yol var; hangisinin geçerli olduğu organizatörün ödeme hesabını bağlayıp
bağlamadığına göre değişir.

**Organizatör bağlıysa (varsayılan, otomatik):**

```
İrfan'ın kartı ──► Stripe ödeme anında böler
                     ├──► organizatörün kendi hesabı   (%90)
                     └──► uygulama sahibinin hesabı    (%10 komisyon)
```

**Organizatör bağlı değilse (yedek yol):**

```
İrfan'ın kartı ──► Uygulama sahibinin hesabı ──► (sonra) elle organizatöre
```

- Komisyon oranı `COMMISSION_RATE` ile ayarlanır (varsayılan `0.10` = %10).
- Her ödeme kaydında `commission_minor` (sahibin payı),
  `organizer_share_minor` (organizatörün payı) ve `payout_mode`
  (`connect` = gitti, `platform` = hâlâ borç) tutulur.
- Uygulama sahibi `#/dashboard` ekranında tahsilatı, komisyonu, otomatik giden
  payı, elle ödenecek borcu, iadeleri ve ödeme dökümünü görür.

Tutarlar veritabanında **kuruş** (tam sayı) olarak saklanır — kayan nokta
yuvarlama hatası olmaz. ₺150 → `15000`.

### Ödeme sağlayıcısı

| Mod | Ne zaman | Davranış |
| --- | --- | --- |
| `demo` | `STRIPE_SECRET_KEY` tanımlı değilken (varsayılan) | Uygulama içi kart formu. Gerçek para hareketi yok. Test kartı `4242 4242 4242 4242`, reddedilen kart `4000 0000 0000 0002`. |
| `stripe` | `STRIPE_SECRET_KEY` tanımlıyken | Gerçek Stripe Checkout. Kullanıcı Stripe'a yönlenir, dönüşte ödeme sunucu tarafında doğrulanır. Para, anahtarın ait olduğu (uygulama sahibinin) Stripe hesabına geçer. İptalde Stripe üzerinden iade yapılır. |

Stripe'a geçmek için `.env.example` dosyasını `.env` olarak kopyalayıp
`STRIPE_SECRET_KEY` ve `PUBLIC_URL` değerlerini doldurman yeterli — kod
değişikliği gerekmez. Stripe SDK'sı kurulmaz; REST API'ye doğrudan istek atılır.

> Kart bilgileri hiçbir modda veritabanına yazılmaz; yalnızca son 4 hane
> (demo modunda) makbuz için saklanır.

### Organizatörlere otomatik ödeme (Stripe Connect)

Organizatör **Profil → Ödeme hesabım** bölümünden Stripe hesabını bağlar.
Kimlik doğrulama, vergi formu ve banka bilgisi adımlarının tamamını Stripe kendi
ekranlarında yürütür; bu veriler uygulamaya hiç uğramaz. Hesap aktif olduğunda o
organizatörün etkinliklerine yapılan her ödeme anında bölünür: payı kendi
hesabına, komisyon sahibin hesabına geçer.

| Uç | Ne yapar |
| --- | --- |
| `POST /api/me/payouts/onboard` | Hesabı açar (yoksa) ve Stripe kurulum bağlantısını verir |
| `POST /api/me/payouts/refresh` | Hesabın durumunu Stripe'tan yeniden okur |
| `GET` `/api/me/payouts` | Güncel durum (bağlı mı, hazır mı) |
| `GET` `/api/me/payouts/dashboard` | Organizatörün kendi Stripe paneline tek kullanımlık bağlantı |

Teknik olarak bu bir *destination charge*: Checkout oturumuna
`transfer_data[destination]` ve `application_fee_amount` eklenir, Stripe parayı
tek adımda taşır ve komisyonu platforma geri alır. İadelerde `reverse_transfer`
ve `refund_application_fee` kullanılır; böylece iptal, parayı iki taraftan da
geri çeker, sahibin cebinden çıkmaz.

Hesabını bağlamamış organizatörler de çalışmaya devam eder: etkinlikleri yukarıdaki
yedek yola düşer ve borç, sahibin panelinde görünür. Otomatik ödemeyi tamamen
kapatmak için `STRIPE_CONNECT=false`.

> Connect'in bağlı hesap ve transfer başına ek maliyeti vardır; güncel rakamlar
> [stripe.com/connect/pricing](https://stripe.com/connect/pricing) adresinde.

### Ödemeyi güvenilir biçimde onaylamak

`POST /api/stripe/webhook` ucu `checkout.session.completed` olayını dinler. Bu
olmadan ödeme yalnızca kullanıcının tarayıcısı Stripe'tan geri döndüğünde
onaylanır; ödeyip sekmeyi kapatan biri parayı verir ama bilet alamaz.
`STRIPE_WEBHOOK_SECRET` tanımlayıp Stripe'ta bu adrese bir webhook ekle. İmza
ham gövde üzerinden doğrulanır, 5 dakikadan eski tekrarlar reddedilir ve onay
idempotenttir; webhook ile tarayıcı dönüşü aynı anda gelse bile kayıt bozulmaz.

Kullanıcı Stripe'tayken etkinlik dolarsa ödeme otomatik iade edilir; parası
alınıp yersiz kalmaz.

---

## Dil desteği

Uygulama Türkçe ve İngilizce çalışır. Dil, üst çubuktaki **TR / EN** düğmesinden
ya da Profil sayfasından değiştirilir; seçim `localStorage`'a yazılır ve sonraki
açılışlarda hatırlanır. Seçim yoksa tarayıcı dili kullanılır, o da desteklenmiyorsa
`DEFAULT_LANG` devreye girer.

Çeviri iki katmanda yapılır:

| Katman | Dosya | Kapsam |
| --- | --- | --- |
| Arayüz | `public/i18n.js` | Tüm ekran metinleri, butonlar, boş durumlar, bildirimler |
| Sunucu | `messages.js` | API'nin döndürdüğü hata ve doğrulama mesajları |

İstemci, seçili dili her API isteğinde `X-Lang` başlığıyla gönderir; sunucu
sırayla `?lang=` sorgusuna, `X-Lang` başlığına, `Accept-Language` başlığına ve
son olarak `DEFAULT_LANG`'e bakar. Böylece "Şifre en az 8 karakter olmalı" gibi
mesajlar da kullanıcının dilinde gelir.

Dile bağlı biçimlendirme `Intl` ile yapılır: tarihler (`25 Ağustos 2026 Salı` ↔
`Tuesday 25 August 2026`), saatler ve para birimi. Tutarlar her dilde kısa
simgeyle gösterilir (`₺150`).

Kategori ve seviye değerleri veritabanında tek bir kanonik biçimde (Türkçe)
saklanır, ekranda çevrilir — böylece dil değiştirince filtreler bozulmaz.
Etkinlik başlığı ve açıklaması ise organizatörün yazdığı içeriktir ve makine
çevirisine sokulmaz; hangi dilde yazıldıysa öyle görünür.

### Yeni dil eklemek

1. `public/i18n.js` içindeki `LANGS` dizisine bir satır ekle
   (`{ code, label, flag, locale }`).
2. Aynı dosyadaki `DICT`'e aynı anahtarlarla bir çeviri nesnesi ekle.
3. `messages.js` içindeki `DICT`'e sunucu mesajlarını ekle.

Eksik bırakılan anahtarlar varsayılan dile düşer, uygulama kırılmaz.

---

## Telefona uygulama olarak kurmak

### 1. PWA (en hızlı yol, mağaza gerekmez)

Sunucuyu HTTPS bir adreste yayına al, telefondan aç:

- **iOS:** Safari → Paylaş → *Ana Ekrana Ekle*
- **Android:** Chrome → menü → *Uygulamayı yükle*

Sonuç: ana ekranda ikon, tam ekran (adres çubuğu yok), çevrimdışı açılabilen
kabuk. `public/manifest.webmanifest` ve `public/sw.js` bunun için hazırdır;
ikonlar `tools/make-icons.js` tarafından koddan üretilir.

### 2. Native iOS / Android (App Store / Play Store)

```bash
cd event-app
npm install --save-dev @capacitor/cli @capacitor/core @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
npx cap sync
npx cap open ios       # Xcode açılır
npx cap open android   # Android Studio açılır
```

Native kabuk API'ye HTTP üzerinden ulaşmalıdır. `capacitor.config.json`
içine sunucunun adresini ekle:

```json
"server": { "url": "https://meetapp.example.com", "androidScheme": "https" }
```

Arayüz zaten dokunmatik hedef boyutlarına, `safe-area-inset` değerlerine ve
16px form yazı boyutuna (iOS'ta odaklanınca zoom olmaması için) göre yazıldı.

> App Store notu: iOS'ta **fiziksel bir etkinliğe katılım ücreti** dış ödeme
> yöntemiyle tahsil edilebilir (App Store yönergeleri 3.1.3(e), gerçek dünyada
> tüketilen hizmetler). Dijital içerik satılsaydı uygulama içi satın alma
> zorunlu olurdu.

---

## Yayına alma

Uygulama tek bir Node süreci ve tek bir SQLite dosyasıdır; **kalıcı disk veren**
herhangi bir sunucuda çalışır. Vercel/Netlify gibi sunucusuz platformlar
uygun değildir — dosya sistemi kalıcı olmadığı için veritabanı her dağıtımda silinir.

Depoda hazır bir `Dockerfile` var: veriyi `/data` klasörüne yazar, `/api/health`
ucuyla canlılık bildirir ve `0.0.0.0` üzerinden dinler.

```bash
docker build -t meetapp .
docker run -p 3000:3000 -v meetapp-data:/data \
  -e SESSION_SECRET="uzun-rastgele-bir-dize" \
  -e PUBLIC_URL="https://senin-alan-adin.com" \
  -e OWNER_EMAIL="sen@ornek.com" -e OWNER_PASSWORD="guclu-bir-sifre" \
  meetapp
```

Üretimde mutlaka ayarlanması gerekenler:

| Değişken | Neden |
| --- | --- |
| `NODE_ENV=production` | Oturum çerezini `secure` yapar (yalnız HTTPS) |
| `SESSION_SECRET` | Uzun ve rastgele olmalı; değişirse herkes çıkış yapar |
| `PUBLIC_URL` | Stripe ödeme sonrası kullanıcıyı buraya döndürür |
| `DB_PATH` | Kalıcı diskteki yolu göstermeli (örn. `/data/meetapp.db`) |
| `OWNER_EMAIL` / `OWNER_PASSWORD` | İlk açılışta sahip hesabı bununla kurulur |
| `STRIPE_SECRET_KEY` | Gerçek ödeme için; yoksa demo modda kalır |

> İlk açılışta veritabanı boşsa demo verisi (örnek etkinlikler ve
> `irfan@example.com` gibi test hesapları) yüklenir. Gerçek kullanıcılara
> açmadan önce bunları `#/dashboard`den ya da veritabanından temizle.

---

## Mimari

```
event-app/
├── server.js                 Express API + SPA sunumu
├── db.js                     SQLite şeması (users, events, registrations, payments)
├── payments.js               Ödeme sağlayıcısı (Stripe REST / demo)
├── messages.js               Sunucu mesajlarının çevirileri (tr / en)
├── config.js                 Ortam değişkenlerinden yapılandırma
├── seed.js                   Demo verisi
├── capacitor.config.json     Native paketleme
├── Dockerfile                Üretim imajı (veri /data'da)
├── tools/
│   ├── make-icons.js         PNG ikon üreteci (bağımlılıksız)
│   └── smoke-test.js         Uçtan uca test
└── public/
    ├── index.html            Uygulama kabuğu
    ├── app.js                Hash tabanlı yönlendirici + tüm ekranlar
    ├── i18n.js               Arayüz çevirileri ve dil yönetimi
    ├── style.css             Tasarım belirteçleri, açık/koyu tema, duyarlı yerleşim
    ├── manifest.webmanifest  PWA tanımı
    ├── sw.js                 Service worker
    └── icons/                Üretilmiş ikonlar
```

Derleme adımı yok. `public/` içindeki dosyalar tarayıcıya olduğu gibi gider;
bu yüzden Capacitor da aynı klasörü paketleyebilir.

### Veri modeli

- **users** — ad, e-posta, bcrypt şifre özeti, rol (`user` / `owner`)
- **events** — organizatör, tarih, mekân, kontenjan, kuruş cinsinden ücret, durum
- **registrations** — etkinlik + kullanıcı (benzersiz çift), durum, bilet kodu, giriş zamanı
- **payments** — kayıt, tutar, sağlayıcı, sağlayıcı referansı, durum, komisyon dağılımı

Kontenjan kontrolü, kayıt ve ödeme oluşturma tek bir SQLite işlemi (transaction)
içinde yapılır; yarım kalmış durum oluşmaz.

### API

| Yöntem | Yol | Açıklama |
| --- | --- | --- |
| `GET` | `/api/health` | Canlılık kontrolü (hosting sağlayıcıları için) |
| `GET` | `/api/config` | Uygulama adı, para birimi, ödeme modu, desteklenen diller |
| `POST` | `/api/auth/register` · `/login` · `/logout` | Oturum yönetimi |
| `GET` `PATCH` | `/api/me` | Profil |
| `GET` | `/api/events` | Arama + kategori/şehir filtresi |
| `GET` | `/api/events/:id` | Detay + katılımcılar |
| `POST` | `/api/events` | Etkinlik oluştur |
| `POST` | `/api/events/:id/cancel` | Etkinliği iptal et (organizatör) |
| `POST` | `/api/events/:id/join` | Yer ayır → ücretsizse onay, ücretliyse ödeme başlat |
| `GET` | `/api/payments/:id` | Ödeme durumu |
| `POST` | `/api/payments/:id/confirm` | Ödemeyi tamamla (demo kart ya da Stripe doğrulaması) |
| `POST` | `/api/registrations/:id/cancel` | İptal + iade |
| `GET` | `/api/events/:id/attendees` | Katılımcı listesi (organizatör) |
| `POST` | `/api/events/:id/checkin` | Bilet kodunu doğrula (organizatör) |
| `POST` | `/api/stripe/webhook` | Stripe ödeme onayları (imza doğrulanır) |
| `GET` `POST` | `/api/me/payouts` · `/onboard` · `/refresh` · `/dashboard` | Organizatörün ödeme hesabı (Connect) |
| `GET` | `/api/my/registrations` · `/my/events` · `/my/payments` | Kullanıcının kendi verisi |
| `GET` | `/api/owner/summary` · `/owner/payments` | Gelir paneli (yalnız uygulama sahibi) |

### Güvenlik

- Şifreler bcrypt ile saklanır; oturumlar `httpOnly` çerezle taşınır ve SQLite'ta tutulur.
- Helmet + içerik güvenlik politikası; giriş ve ödeme uçlarında hız sınırı.
- Yetki kontrolleri sunucuda: katılımcı listesi ve giriş kontrolü yalnız
  organizatöre, gelir paneli yalnız `owner` rolüne açıktır.
- Kullanıcıdan gelen tüm metinler arayüzde kaçışlanarak basılır (XSS koruması);
  çeviri yer tutucularına giren değerler de aynı şekilde kaçışlanır.
- Üretimde `NODE_ENV=production` ile çerez `secure` olur; `SESSION_SECRET`
  mutlaka değiştirilmelidir.

---

## Test

```bash
npm run smoke
```

60 kontrol: kayıt doğrulaması, arama, ücretli katılımda ödeme zorunluluğu,
reddedilen kart, başarılı ödeme ve bilet üretimi, çift katılım engeli, ücretsiz
etkinlikte anında onay, organizatör giriş kontrolü ve tekrar kullanım engeli,
yetkisiz erişim reddi, iade ve gelir raporuna yansıması, dil pazarlığı
(`X-Lang`, `?lang=`, varsayılana düşme), çevrilmiş hata mesajları, Connect
kurulumu ve otomatik bölüşüm, webhook imza reddi (yanlış imza ve zamanı geçmiş
tekrar) ile idempotent onay, ve ödemenin iade edilmesi gereken kontenjan yarışı.
