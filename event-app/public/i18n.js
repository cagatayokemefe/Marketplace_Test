/* ════════════════════════════════════════════════════════════════════════════
   MeetApp — arayüz çevirileri
   Yeni dil eklemek için: LANGS'e bir satır, DICT'e aynı anahtarlarla bir nesne.
   Eksik anahtarlar varsayılan dile düşer, o da yoksa anahtarın kendisi basılır.
   ════════════════════════════════════════════════════════════════════════════ */

window.I18N = (function () {
  "use strict";

  var STORAGE_KEY = "meetapp.lang";
  var FALLBACK = "tr";

  var LANGS = [
    { code: "tr", label: "Türkçe", flag: "🇹🇷", locale: "tr-TR" },
    { code: "en", label: "English", flag: "🇬🇧", locale: "en-GB" },
  ];

  // Etkinlik kategorisi ve seviyesi veritabanında Türkçe saklanır (filtreler bu
  // değerlerle çalışır); ekranda gösterilirken çevrilir.
  var CATEGORIES = ["Sports", "Outdoors", "Wellness", "Tech", "Art", "Music", "Social"];
  var LEVELS = ["All", "Beginner", "Intermediate", "Advanced"];

  var DICT = {
    tr: {
      "app.tagline": "Etkinlik bul, katıl, öde",

      "tab.discover": "Keşfet",
      "tab.myEvents": "Etkinliklerim",
      "tab.create": "Oluştur",
      "tab.profile": "Profil",
      "tab.panel": "Panel",
      "nav.signIn": "Giriş yap",
      "a11y.theme": "Temayı değiştir",
      "a11y.language": "Dili değiştir",
      "a11y.profile": "Profil",

      "discover.title": "Yakınında neler var?",
      "discover.subtitle": "Etkinliği seç, yerini ödemeyle garantile.",
      "discover.searchPlaceholder": "Voleybol, yoga, İstanbul…",
      "discover.emptyTitle": "Bu filtreyle etkinlik yok",
      "discover.emptyBody": "Aramayı temizle ya da kendi etkinliğini oluştur.",
      "discover.emptyCta": "Etkinlik oluştur",
      "filter.all": "Tümü",
      "filter.allCities": "Tüm şehirler",

      "card.free": "Ücretsiz",
      "card.full": "Kontenjan dolu",
      "card.spotsLeft_one": "1 kişilik yer",
      "card.spotsLeft_other": "{count} kişilik yer",
      "card.joined": "Katılıyorsun",

      "time.finished": "Tamamlandı",
      "time.inDays_one": "1 gün sonra",
      "time.inDays_other": "{count} gün sonra",
      "time.inHours_one": "1 saat sonra",
      "time.inHours_other": "{count} saat sonra",
      "time.inMinutes_one": "1 dk sonra",
      "time.inMinutes_other": "{count} dk sonra",

      "detail.backToDiscover": "← Keşfet",
      "detail.about": "Etkinlik hakkında",
      "detail.attendees": "Katılanlar",
      "detail.noAttendees": "Henüz kimse katılmadı — ilk sen ol!",
      "detail.attendeeCount_one": "toplam 1 katılımcı",
      "detail.attendeeCount_other": "toplam {count} katılımcı",
      "detail.andMore": "+{count} kişi daha · ",
      "detail.hostTools": "Organizatör araçları",
      "detail.attendeeListCta": "Katılımcı listesi & giriş kontrolü",
      "detail.cancelEvent": "Etkinliği iptal et",
      "detail.cancelledBadge": "İptal edildi",

      "info.date": "Tarih",
      "info.place": "Yer",
      "info.capacity": "Kontenjan",
      "info.host": "Organizatör",
      "info.capacityValue": "{count} / {capacity} kişi",
      "info.capacityFull": " · dolu",
      "info.capacityLeft": " · {count} yer kaldı",

      "action.perPerson": "kişi başı",
      "action.noFee": "katılım ücreti yok",
      "action.eventCancelled": "Etkinlik iptal edildi",
      "action.eventPast": "Bu etkinlik geçti",
      "action.seeAttendees": "Katılımcıları gör",
      "action.showTicket": "Biletimi göster",
      "action.leave": "Katılımı iptal et",
      "action.full": "Kontenjan dolu",
      "action.joinFree": "Ücretsiz katıl",
      "action.joinPay": "Katıl ve öde",
      "action.joining": "Yer ayrılıyor…",

      "checkout.back": "← Vazgeç",
      "checkout.title": "Ödeme",
      "checkout.demoNotice":
        "Demo modu: gerçek para çekilmez. Test kartı <b>{success}</b>, reddedilen kart <b>{declined}</b>.",
      "checkout.holder": "Kart üzerindeki isim",
      "checkout.holderPlaceholder": "İrfan Yılmaz",
      "checkout.cardNumber": "Kart numarası",
      "checkout.expiry": "Son kullanma",
      "checkout.expiryPlaceholder": "12/29",
      "checkout.cvc": "CVC",
      "checkout.pay": "{amount} öde",
      "checkout.paying": "Ödeme alınıyor…",
      "checkout.secure": "🔒 Ödeme {owner} hesabına aktarılır.",
      "checkout.summary": "Özet",
      "checkout.fee": "Katılım ücreti",
      "checkout.serviceFee": "Hizmet bedeli",
      "checkout.total": "Toplam",
      "checkout.verifying": "Ödemen doğrulanıyor…",
      "checkout.verifyingBody": "Bu sayfadan ayrılma.",

      "ticket.back": "← Etkinliklerim",
      "ticket.entryCode": "Giriş kodu",
      "ticket.showAtDoor": "Girişte organizatöre göster",
      "ticket.checkedIn": "✓ Giriş yapıldı",
      "ticket.paid": "Ödenen",
      "ticket.eventPage": "Etkinlik sayfası",
      "ticket.notFound": "Bilet bulunamadı.",
      "ticket.notConfirmed": "Bu kayıt henüz onaylanmadı ({status}).",

      "my.title": "Etkinliklerim",
      "my.tabJoined": "Katıldıklarım",
      "my.tabHosted": "Oluşturduklarım",
      "my.upcoming": "Yaklaşanlar",
      "my.pastAndCancelled": "Geçmiş & iptaller",
      "my.emptyJoinedTitle": "Henüz bir etkinliğe katılmadın",
      "my.emptyJoinedBody": "Keşfet sekmesinden ilgini çeken bir şey bul.",
      "my.emptyJoinedCta": "Etkinlikleri keşfet",
      "my.emptyHostedTitle": "Henüz etkinlik oluşturmadın",
      "my.emptyHostedBody": "Kendi voleybol maçını ya da atölyeni dakikalar içinde yayınla.",
      "my.emptyHostedCta": "Etkinlik oluştur",

      "status.cancelled": "İptal edildi",
      "status.pendingPayment": "Ödeme bekliyor",
      "status.checkedIn": "Giriş yapıldı",
      "status.confirmed": "Onaylı",

      "host.payable": "{amount} alacak",
      "host.live": "Yayında",
      "host.completed": "Tamamlandı",
      "host.cancelled": "İptal",
      "host.payments_one": "1 ödeme",
      "host.payments_other": "{count} ödeme",

      "att.back": "← Etkinlik",
      "att.title": "Katılımcılar",
      "att.subtitle": "{title} · {count}/{capacity} kişi",
      "att.checkin": "Giriş kontrolü",
      "att.codePlaceholder": "ABCD-1234",
      "att.verify": "Kodu doğrula",
      "att.list": "Liste",
      "att.colName": "Ad",
      "att.colContact": "İletişim",
      "att.colTicket": "Bilet",
      "att.colPayment": "Ödeme",
      "att.colStatus": "Durum",
      "att.waiting": "Bekleniyor",
      "att.arrived": "Giriş yaptı",
      "att.emptyTitle": "Henüz katılımcı yok",
      "att.checkedInOk": "✓ {name} içeri alındı.",

      "pay.paid": "Ödendi",
      "pay.pending": "Bekliyor",
      "pay.refunded": "İade",
      "pay.failed": "Başarısız",

      "create.title": "Etkinlik oluştur",
      "create.subtitle": "Ücreti sen belirle; katılımcılar uygulamadan ödesin.",
      "create.cover": "Kapak simgesi",
      "create.eventTitle": "Başlık",
      "create.titlePlaceholder": "Salı Akşamı Voleybol",
      "create.desc": "Açıklama",
      "create.descPlaceholder": "Seviye, ekipman, buluşma noktası…",
      "create.category": "Kategori",
      "create.level": "Seviye",
      "create.city": "Şehir",
      "create.cityPlaceholder": "İstanbul",
      "create.venue": "Mekân",
      "create.venuePlaceholder": "Kadıköy Spor Salonu",
      "create.address": "Adres",
      "create.addressPlaceholder": "Caferağa Mah. Spor Cad. No:12",
      "create.start": "Beginner",
      "create.duration": "Süre (saat)",
      "create.capacity": "Kontenjan",
      "create.price": "Kişi başı ücret ({symbol})",
      "create.priceHint": "0 yazarsan etkinlik ücretsiz olur.",
      "create.payoutNote":
        "Katılımcı ödemeleri {owner} hesabında toplanır. Etkinlik sonrası payın (%{percent}) sana aktarılır.",
      "create.submit": "Etkinliği yayınla",
      "create.submitting": "Yayınlanıyor…",

      "profile.ownerBadge": "Uygulama sahibi",
      "profile.openPanel": "📊 Gelir panelini aç",
      "profile.myInfo": "Bilgilerim",
      "profile.name": "Ad soyad",
      "profile.city": "Şehir",
      "profile.phone": "Telefon",
      "profile.bio": "Hakkımda",
      "profile.save": "Kaydet",
      "profile.language": "Dil",
      "profile.languageHint": "Seçimin bu cihazda hatırlanır.",
      "profile.payHistory": "Ödeme geçmişim",
      "profile.noPayments": "Henüz ödeme yok.",
      "profile.logout": "Çıkış yap",
      "col.event": "Etkinlik",
      "col.amount": "Tutar",
      "col.status": "Durum",
      "col.date": "Tarih",

      "owner.title": "Gelir paneli",
      "owner.subtitle": "Tüm katılım ücretleri bu hesapta toplanıyor · ödeme altyapısı: {provider}",
      "owner.providerStripe": "Stripe (canlı)",
      "owner.providerDemo": "demo",
      "owner.gross": "Toplam tahsilat",
      "owner.commission": "Platform komisyonu (%{percent})",
      "owner.payable": "Organizatörlere borç",
      "owner.refunded": "İade edilen",
      "owner.paidCount": "Ödeme sayısı",
      "owner.pendingCount": "Bekleyen ödeme",
      "owner.users": "Kayıtlı kullanıcı",
      "owner.liveEvents": "Yayındaki etkinlik",
      "owner.byEvent": "Etkinlik bazında",
      "owner.colHost": "Organizatör",
      "owner.colPayments": "Ödeme",
      "owner.colGross": "Tahsilat",
      "owner.colCommission": "Komisyon",
      "owner.colPayable": "Ödenecek",
      "owner.noPayments": "Henüz ödeme yok",
      "owner.recent": "Son ödemeler",
      "owner.colUser": "Kullanıcı",
      "owner.colMethod": "Yöntem",
      "owner.noRecords": "Kayıt yok",

      "auth.welcomeBack": "Tekrar hoş geldin",
      "auth.welcomeBackSub": "Etkinliklerine devam et.",
      "auth.joinTitle": "MeetApp'a katıl",
      "auth.joinSub": "Birkaç saniyede hesabını oluştur.",
      "auth.name": "Ad soyad",
      "auth.namePlaceholder": "İrfan Yılmaz",
      "auth.email": "E-posta",
      "auth.password": "Şifre",
      "auth.passwordHint": "En az 8 karakter.",
      "auth.cityOptional": "Şehir (isteğe bağlı)",
      "auth.signIn": "Giriş yap",
      "auth.signUp": "Hesap oluştur",
      "auth.wait": "Lütfen bekle…",
      "auth.demoAccounts": "Denemek için hazır hesaplar:",
      "auth.fill": "doldur",
      "auth.ownerAccount": "uygulama sahibi",
      "auth.noAccount": "Hesabın yok mu?",
      "auth.register": "Kayıt ol",
      "auth.haveAccount": "Zaten üye misin?",
      "auth.browse": "Etkinliklere göz at",

      "common.errorTitle": "Olmadı",
      "common.backToDiscover": "Keşfet'e dön",
      "common.pageNotFound": "Aradığın sayfa yok.",
      "common.genericError": "Bir hata oluştu.",
      "confirm.leave": "Katılımını iptal etmek istediğine emin misin?",
      "confirm.cancelEvent": "Etkinliği iptal etmek üzeresin. Devam edilsin mi?",

      "toast.joined": "Kaydın tamam! Görüşmek üzere 🎉",
      "toast.paid": "Ödeme alındı, biletin hazır 🎟️",
      "toast.cancelledRefunded": "İptal edildi, ücret iade edildi.",
      "toast.cancelled": "Katılımın iptal edildi.",
      "toast.eventCancelled": "Etkinlik iptal edildi.",
      "toast.eventPublished": "Etkinliğin yayında 🎉",
      "toast.profileSaved": "Bilgilerin güncellendi.",
      "toast.loggedOut": "Çıkış yapıldı.",
      "toast.welcome": "Hoş geldin, {name}!",
      "toast.languageChanged": "Dil Türkçe olarak ayarlandı.",

      "category.Sports": "Spor",
      "category.Outdoors": "Doğa",
      "category.Wellness": "Sağlık",
      "category.Tech": "Teknoloji",
      "category.Art": "Sanat",
      "category.Music": "Müzik",
      "category.Social": "Sosyal",

      "level.All": "Herkes",
      "level.Beginner": "Başlangıç",
      "level.Intermediate": "Orta",
      "level.Advanced": "İleri",
    },

    en: {
      "app.tagline": "Find an event, join, pay",

      "tab.discover": "Discover",
      "tab.myEvents": "My events",
      "tab.create": "Create",
      "tab.profile": "Profile",
      "tab.panel": "Dashboard",
      "nav.signIn": "Sign in",
      "a11y.theme": "Toggle theme",
      "a11y.language": "Change language",
      "a11y.profile": "Profile",

      "discover.title": "What's happening near you?",
      "discover.subtitle": "Pick an event and lock in your spot by paying.",
      "discover.searchPlaceholder": "Volleyball, yoga, Istanbul…",
      "discover.emptyTitle": "No events match this filter",
      "discover.emptyBody": "Clear the search, or host your own event.",
      "discover.emptyCta": "Create an event",
      "filter.all": "All",
      "filter.allCities": "All cities",

      "card.free": "Free",
      "card.full": "Sold out",
      "card.spotsLeft_one": "1 spot left",
      "card.spotsLeft_other": "{count} spots left",
      "card.joined": "You're going",

      "time.finished": "Finished",
      "time.inDays_one": "in 1 day",
      "time.inDays_other": "in {count} days",
      "time.inHours_one": "in 1 hour",
      "time.inHours_other": "in {count} hours",
      "time.inMinutes_one": "in 1 min",
      "time.inMinutes_other": "in {count} min",

      "detail.backToDiscover": "← Discover",
      "detail.about": "About this event",
      "detail.attendees": "Who's going",
      "detail.noAttendees": "Nobody has joined yet — be the first!",
      "detail.attendeeCount_one": "1 person going",
      "detail.attendeeCount_other": "{count} people going",
      "detail.andMore": "+{count} more · ",
      "detail.hostTools": "Host tools",
      "detail.attendeeListCta": "Attendee list & check-in",
      "detail.cancelEvent": "Cancel this event",
      "detail.cancelledBadge": "Cancelled",

      "info.date": "Date",
      "info.place": "Location",
      "info.capacity": "Capacity",
      "info.host": "Host",
      "info.capacityValue": "{count} / {capacity} people",
      "info.capacityFull": " · sold out",
      "info.capacityLeft": " · {count} spots left",

      "action.perPerson": "per person",
      "action.noFee": "no fee to join",
      "action.eventCancelled": "Event cancelled",
      "action.eventPast": "This event has passed",
      "action.seeAttendees": "See attendees",
      "action.showTicket": "Show my ticket",
      "action.leave": "Cancel my spot",
      "action.full": "Sold out",
      "action.joinFree": "Join for free",
      "action.joinPay": "Join and pay",
      "action.joining": "Holding your spot…",

      "checkout.back": "← Back",
      "checkout.title": "Checkout",
      "checkout.demoNotice":
        "Demo mode: no real money is charged. Test card <b>{success}</b>, declined card <b>{declined}</b>.",
      "checkout.holder": "Name on card",
      "checkout.holderPlaceholder": "Irfan Yilmaz",
      "checkout.cardNumber": "Card number",
      "checkout.expiry": "Expiry",
      "checkout.expiryPlaceholder": "12/29",
      "checkout.cvc": "CVC",
      "checkout.pay": "Pay {amount}",
      "checkout.paying": "Taking payment…",
      "checkout.secure": "🔒 Payment goes to {owner}.",
      "checkout.summary": "Summary",
      "checkout.fee": "Ticket price",
      "checkout.serviceFee": "Service fee",
      "checkout.total": "Total",
      "checkout.verifying": "Verifying your payment…",
      "checkout.verifyingBody": "Please stay on this page.",

      "ticket.back": "← My events",
      "ticket.entryCode": "Entry code",
      "ticket.showAtDoor": "Show this to the host at the door",
      "ticket.checkedIn": "✓ Checked in",
      "ticket.paid": "Paid",
      "ticket.eventPage": "Event page",
      "ticket.notFound": "Ticket not found.",
      "ticket.notConfirmed": "This registration is not confirmed yet ({status}).",

      "my.title": "My events",
      "my.tabJoined": "Going",
      "my.tabHosted": "Hosting",
      "my.upcoming": "Upcoming",
      "my.pastAndCancelled": "Past & cancelled",
      "my.emptyJoinedTitle": "You haven't joined an event yet",
      "my.emptyJoinedBody": "Find something you like on the Discover tab.",
      "my.emptyJoinedCta": "Discover events",
      "my.emptyHostedTitle": "You haven't created an event yet",
      "my.emptyHostedBody": "Publish your own volleyball match or workshop in minutes.",
      "my.emptyHostedCta": "Create an event",

      "status.cancelled": "Cancelled",
      "status.pendingPayment": "Payment pending",
      "status.checkedIn": "Checked in",
      "status.confirmed": "Confirmed",

      "host.payable": "{amount} payable",
      "host.live": "Live",
      "host.completed": "Completed",
      "host.cancelled": "Cancelled",
      "host.payments_one": "1 payment",
      "host.payments_other": "{count} payments",

      "att.back": "← Event",
      "att.title": "Attendees",
      "att.subtitle": "{title} · {count}/{capacity} people",
      "att.checkin": "Check-in",
      "att.codePlaceholder": "ABCD-1234",
      "att.verify": "Verify code",
      "att.list": "List",
      "att.colName": "Name",
      "att.colContact": "Contact",
      "att.colTicket": "Ticket",
      "att.colPayment": "Payment",
      "att.colStatus": "Status",
      "att.waiting": "Not arrived",
      "att.arrived": "Checked in",
      "att.emptyTitle": "No attendees yet",
      "att.checkedInOk": "✓ {name} is checked in.",

      "pay.paid": "Paid",
      "pay.pending": "Pending",
      "pay.refunded": "Refunded",
      "pay.failed": "Failed",

      "create.title": "Create an event",
      "create.subtitle": "You set the price; attendees pay in the app.",
      "create.cover": "Cover icon",
      "create.eventTitle": "Title",
      "create.titlePlaceholder": "Tuesday Night Volleyball",
      "create.desc": "Description",
      "create.descPlaceholder": "Skill level, gear, where to meet…",
      "create.category": "Category",
      "create.level": "Level",
      "create.city": "City",
      "create.cityPlaceholder": "Istanbul",
      "create.venue": "Venue",
      "create.venuePlaceholder": "Kadıköy Sports Hall",
      "create.address": "Address",
      "create.addressPlaceholder": "Caferağa Mah. Spor Cad. No:12",
      "create.start": "Starts",
      "create.duration": "Duration (hours)",
      "create.capacity": "Capacity",
      "create.price": "Price per person ({symbol})",
      "create.priceHint": "Enter 0 to make the event free.",
      "create.payoutNote":
        "Attendee payments are collected by {owner}. Your share ({percent}%) is transferred to you after the event.",
      "create.submit": "Publish event",
      "create.submitting": "Publishing…",

      "profile.ownerBadge": "App owner",
      "profile.openPanel": "📊 Open revenue dashboard",
      "profile.myInfo": "My details",
      "profile.name": "Full name",
      "profile.city": "City",
      "profile.phone": "Phone",
      "profile.bio": "About me",
      "profile.save": "Save",
      "profile.language": "Language",
      "profile.languageHint": "Your choice is remembered on this device.",
      "profile.payHistory": "My payment history",
      "profile.noPayments": "No payments yet.",
      "profile.logout": "Sign out",
      "col.event": "Event",
      "col.amount": "Amount",
      "col.status": "Status",
      "col.date": "Date",

      "owner.title": "Revenue dashboard",
      "owner.subtitle": "Every participation fee lands in this account · payment provider: {provider}",
      "owner.providerStripe": "Stripe (live)",
      "owner.providerDemo": "demo",
      "owner.gross": "Total collected",
      "owner.commission": "Platform commission ({percent}%)",
      "owner.payable": "Owed to hosts",
      "owner.refunded": "Refunded",
      "owner.paidCount": "Payments",
      "owner.pendingCount": "Pending payments",
      "owner.users": "Registered users",
      "owner.liveEvents": "Live events",
      "owner.byEvent": "By event",
      "owner.colHost": "Host",
      "owner.colPayments": "Payments",
      "owner.colGross": "Collected",
      "owner.colCommission": "Commission",
      "owner.colPayable": "Payable",
      "owner.noPayments": "No payments yet",
      "owner.recent": "Recent payments",
      "owner.colUser": "User",
      "owner.colMethod": "Method",
      "owner.noRecords": "No records",

      "auth.welcomeBack": "Welcome back",
      "auth.welcomeBackSub": "Pick up where you left off.",
      "auth.joinTitle": "Join MeetApp",
      "auth.joinSub": "Create your account in seconds.",
      "auth.name": "Full name",
      "auth.namePlaceholder": "Irfan Yilmaz",
      "auth.email": "Email",
      "auth.password": "Password",
      "auth.passwordHint": "At least 8 characters.",
      "auth.cityOptional": "City (optional)",
      "auth.signIn": "Sign in",
      "auth.signUp": "Create account",
      "auth.wait": "Please wait…",
      "auth.demoAccounts": "Demo accounts you can use:",
      "auth.fill": "fill in",
      "auth.ownerAccount": "app owner",
      "auth.noAccount": "No account yet?",
      "auth.register": "Sign up",
      "auth.haveAccount": "Already a member?",
      "auth.browse": "Browse events",

      "common.errorTitle": "Something went wrong",
      "common.backToDiscover": "Back to Discover",
      "common.pageNotFound": "That page doesn't exist.",
      "common.genericError": "Something went wrong.",
      "confirm.leave": "Are you sure you want to cancel your spot?",
      "confirm.cancelEvent": "You are about to cancel this event. Continue?",

      "toast.joined": "You're in! See you there 🎉",
      "toast.paid": "Payment received, your ticket is ready 🎟️",
      "toast.cancelledRefunded": "Cancelled, and your payment was refunded.",
      "toast.cancelled": "Your spot has been cancelled.",
      "toast.eventCancelled": "Event cancelled.",
      "toast.eventPublished": "Your event is live 🎉",
      "toast.profileSaved": "Your details were updated.",
      "toast.loggedOut": "Signed out.",
      "toast.welcome": "Welcome, {name}!",
      "toast.languageChanged": "Language set to English.",

      "category.Sports": "Sports",
      "category.Outdoors": "Outdoors",
      "category.Wellness": "Wellness",
      "category.Tech": "Tech",
      "category.Art": "Art",
      "category.Music": "Music",
      "category.Social": "Social",

      "level.All": "All levels",
      "level.Beginner": "Beginner",
      "level.Intermediate": "Intermediate",
      "level.Advanced": "Advanced",
    },
  };

  function isSupported(code) {
    return !!(code && DICT[code]);
  }

  /** Kayıtlı seçim → tarayıcı dili → varsayılan. */
  function detect() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (isSupported(stored)) return stored;
    } catch (e) {
      /* gizli sekmede localStorage kapalı olabilir */
    }
    var candidates = (navigator.languages || [navigator.language || ""]).slice();
    for (var i = 0; i < candidates.length; i++) {
      var code = String(candidates[i]).toLowerCase().split("-")[0];
      if (isSupported(code)) return code;
    }
    return FALLBACK;
  }

  var current = detect();

  function lookup(key) {
    if (DICT[current] && DICT[current][key] !== undefined) return DICT[current][key];
    if (DICT[FALLBACK][key] !== undefined) return DICT[FALLBACK][key];
    return null;
  }

  /**
   * Çeviri. {isim} yer tutucularını params ile doldurur.
   * params.count verilirse tekil/çoğul varyantı (_one / _other) seçilir.
   */
  function t(key, params) {
    var resolved = key;
    if (params && typeof params.count === "number") {
      var variant = key + (Math.abs(params.count) === 1 ? "_one" : "_other");
      if (lookup(variant) !== null) resolved = variant;
    }
    var text = lookup(resolved);
    if (text === null) return key;
    if (!params) return text;
    return text.replace(/\{(\w+)\}/g, function (match, name) {
      return params[name] === undefined ? match : String(params[name]);
    });
  }

  function meta(code) {
    for (var i = 0; i < LANGS.length; i++) {
      if (LANGS[i].code === (code || current)) return LANGS[i];
    }
    return LANGS[0];
  }

  function set(code) {
    if (!isSupported(code) || code === current) return false;
    current = code;
    try {
      localStorage.setItem(STORAGE_KEY, code);
    } catch (e) {
      /* yoksay */
    }
    document.documentElement.setAttribute("lang", code);
    return true;
  }

  document.documentElement.setAttribute("lang", current);

  return {
    t: t,
    set: set,
    get: function () {
      return current;
    },
    locale: function () {
      return meta().locale;
    },
    meta: meta,
    langs: LANGS,
    categories: CATEGORIES,
    levels: LEVELS,
    category: function (value) {
      var out = lookup("category." + value);
      return out === null ? value : out;
    },
    level: function (value) {
      var out = lookup("level." + value);
      return out === null ? value : out;
    },
  };
})();
