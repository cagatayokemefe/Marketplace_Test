# Buluş — etkinlik bul, katıl, öde

Meetup benzeri bir etkinlik uygulaması. Biri voleybol maçı açar, katılmak isteyen
kişi uygulamadan yerini ayırtır, katılım ücretini uygulama üzerinden öder ve
girişte gösterebileceği bir bilet alır. **Tüm ödemeler uygulama sahibinin
hesabında toplanır**; organizatöre ödenecek pay ayrı bir kalem olarak raporlanır.

Tek bir kod tabanı üç yerde çalışır:

| Nerede | Nasıl |
| --- | --- |
| **Web (masaüstü)** | Tarayıcıda `http://localhost:3000` |
| **Telefon — uygulama gibi** | PWA: Safari/Chrome'da "Ana Ekrana Ekle" → tam ekran, ikonlu, çevrimdışı açılan uygulama |
| **Native iOS / Android** | Capacitor ile App Store / Play Store paketi (`capacitor.config.json` hazır) |

Arayüz mobil öncelikli tasarlandı: telefonda alt sekme çubuğu ve sabit ödeme
butonu, masaüstünde üst menü ve iki sütunlu detay sayfası kullanılır. Açık/koyu
tema desteklenir.

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
| **Uygulama sahibi** | `owner@bulus.app` | `owner1234` | Gelir paneli: tüm tahsilat, komisyon, organizatörlere borç |

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
   kayıt `confirmed` olur ve tutar uygulama sahibinin hesabına yazılır.
5. **Bilet** — İrfan'a `ABCD-1234` biçiminde bir giriş kodu verilir. Salonda
   organizatör bu kodu **Katılımcılar → Giriş kontrolü** ekranına yazıp doğrular;
   aynı kod ikinci kez kabul edilmez.
6. **İptal** — Etkinliğe 6 saatten fazla varsa İrfan iptal edebilir, ücret iade edilir.
   Son 6 saatte iade kapalıdır.

---

## Para nasıl akıyor?

```
İrfan'ın kartı ──► Uygulama sahibinin hesabı ──► (etkinlik sonrası) organizatör
                   ▲                              ▲
                   │                              │
            tahsilatın tamamı              komisyon düşülmüş pay
```

- Katılımcının ödediği tutarın **tamamı** uygulama sahibine geçer.
- Her ödeme kaydında `commission_minor` (sahibin payı) ve
  `organizer_share_minor` (organizatöre borç) ayrı ayrı tutulur.
- Komisyon oranı `COMMISSION_RATE` ile ayarlanır (varsayılan `0.10` = %10).
- Uygulama sahibi `#/panel` ekranında toplam tahsilatı, komisyonu,
  organizatörlere olan borcu, iadeleri ve ödeme dökümünü görür.

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
"server": { "url": "https://bulus.ornek.com", "androidScheme": "https" }
```

Arayüz zaten dokunmatik hedef boyutlarına, `safe-area-inset` değerlerine ve
16px form yazı boyutuna (iOS'ta odaklanınca zoom olmaması için) göre yazıldı.

> App Store notu: iOS'ta **fiziksel bir etkinliğe katılım ücreti** dış ödeme
> yöntemiyle tahsil edilebilir (App Store yönergeleri 3.1.3(e), gerçek dünyada
> tüketilen hizmetler). Dijital içerik satılsaydı uygulama içi satın alma
> zorunlu olurdu.

---

## Mimari

```
event-app/
├── server.js                 Express API + SPA sunumu
├── db.js                     SQLite şeması (users, events, registrations, payments)
├── payments.js               Ödeme sağlayıcısı (Stripe REST / demo)
├── config.js                 Ortam değişkenlerinden yapılandırma
├── seed.js                   Demo verisi
├── capacitor.config.json     Native paketleme
├── tools/
│   ├── make-icons.js         PNG ikon üreteci (bağımlılıksız)
│   └── smoke-test.js         Uçtan uca test
└── public/
    ├── index.html            Uygulama kabuğu
    ├── app.js                Hash tabanlı yönlendirici + tüm ekranlar
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
| `GET` | `/api/config` | Uygulama adı, para birimi, ödeme modu |
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
| `GET` | `/api/my/registrations` · `/my/events` · `/my/payments` | Kullanıcının kendi verisi |
| `GET` | `/api/owner/summary` · `/owner/payments` | Gelir paneli (yalnız uygulama sahibi) |

### Güvenlik

- Şifreler bcrypt ile saklanır; oturumlar `httpOnly` çerezle taşınır ve SQLite'ta tutulur.
- Helmet + içerik güvenlik politikası; giriş ve ödeme uçlarında hız sınırı.
- Yetki kontrolleri sunucuda: katılımcı listesi ve giriş kontrolü yalnız
  organizatöre, gelir paneli yalnız `owner` rolüne açıktır.
- Kullanıcıdan gelen tüm metinler arayüzde kaçışlanarak basılır (XSS koruması).
- Üretimde `NODE_ENV=production` ile çerez `secure` olur; `SESSION_SECRET`
  mutlaka değiştirilmelidir.

---

## Test

```bash
npm run smoke
```

35 kontrol: kayıt doğrulaması, arama, ücretli katılımda ödeme zorunluluğu,
reddedilen kart, başarılı ödeme ve bilet üretimi, çift katılım engeli, ücretsiz
etkinlikte anında onay, organizatör giriş kontrolü ve tekrar kullanım engeli,
yetkisiz erişim reddi, iade ve gelir raporuna yansıması.
