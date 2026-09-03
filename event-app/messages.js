"use strict";

/**
 * Sunucu tarafı çeviriler.
 *
 * API'nin döndürdüğü her kullanıcıya görünür metin buradan geçer. Dil sırayla
 * şuradan çözülür: ?lang= sorgusu → X-Lang başlığı → Accept-Language → varsayılan.
 *
 * Yeni bir dil eklemek için DICT'e aynı anahtarlarla bir nesne eklemek yeterli;
 * eksik anahtarlar varsayılan dile düşer.
 */

const config = require("./config");

const DICT = {
  tr: {
    "common.notFound": "Bulunamadı.",
    "common.unknownError": "bilinmeyen hata",
    "server.error": "Beklenmeyen bir hata oluştu.",

    "rate.auth": "Çok fazla deneme yaptınız, lütfen biraz sonra tekrar deneyin.",
    "rate.pay": "Çok fazla ödeme denemesi. Lütfen bekleyin.",

    "auth.required": "Bu işlem için giriş yapmalısın.",
    "auth.sessionMissing": "Oturum bulunamadı.",
    "auth.ownerOnly": "Bu alan sadece uygulama sahibine açık.",
    "auth.nameLength": "Ad soyad 2–60 karakter olmalı.",
    "auth.invalidEmail": "Geçerli bir e-posta gir.",
    "auth.passwordShort": "Şifre en az 8 karakter olmalı.",
    "auth.emailTaken": "Bu e-posta zaten kayıtlı.",
    "auth.badCredentials": "E-posta veya şifre hatalı.",
    "auth.resetInvalid": "Bu bağlantı geçersiz ya da süresi dolmuş. Yeniden iste.",
    "auth.wrongPassword": "Şifre hatalı.",
    "auth.ownerCannotDelete": "Uygulama sahibi hesabı buradan silinemez.",
    "auth.hostHasEvents": "Önce yayındaki etkinliklerini iptal etmelisin.",

    "event.notFound": "Etkinlik bulunamadı.",
    "event.cancelled": "Etkinlik iptal edilmiş.",
    "event.past": "Bu etkinlik geçmişte kalmış.",
    "event.ownEvent": "Kendi etkinliğine zaten kayıtlısın.",
    "event.alreadyJoined": "Bu etkinliğe zaten katılıyorsun.",
    "event.full": "Kontenjan dolu.",
    "event.notOrganizer": "Bu etkinliği sen oluşturmadın.",
    "event.alreadyCancelled": "Bu etkinlik zaten iptal edilmiş.",
    "event.attendeesOrganizerOnly": "Katılımcı listesi sadece organizatöre açık.",
    "event.checkinOrganizerOnly": "Giriş kontrolü sadece organizatöre açık.",

    "ticket.notFound": "Bu koda ait bilet yok.",
    "ticket.invalid": "Bilet geçerli değil ({status}).",
    "ticket.used": "Bu bilet zaten kullanıldı.",

    "validate.title": "Başlık 3–120 karakter olmalı.",
    "validate.city": "Şehir gerekli.",
    "validate.date": "Geçerli bir tarih/saat seç.",
    "validate.futureDate": "Etkinlik tarihi gelecekte olmalı.",
    "validate.capacity": "Kontenjan 1–1000 arasında olmalı.",
    "validate.price": "Geçersiz ücret.",

    "payment.startFailed": "Ödeme başlatılamadı: {reason}",
    "payment.notFound": "Ödeme bulunamadı.",
    "payment.notCompletable": "Bu ödeme artık tamamlanamaz.",
    "payment.capacityFilled": "Kontenjan bu sırada doldu. Ücret alınmadı.",
    "payment.capacityFilledRefunded":
      "Kontenjan bu sırada doldu. Ödemen iade edildi.",
    "payment.sessionMissing": "Ödeme oturumu bulunamadı.",
    "payment.verifyFailed": "Ödeme doğrulanamadı: {reason}",
    "payment.notPaid": "Ödeme henüz tamamlanmamış.",
    "payment.cardInvalid": "Kart numarası geçersiz.",
    "payment.expiryInvalid": "Son kullanma tarihi AA/YY biçiminde olmalı.",
    "payment.cvcInvalid": "CVC geçersiz.",
    "payment.holderRequired": "Kart üzerindeki ismi gir.",
    "payment.declined": "Kart reddedildi. Başka bir kart dene.",

    "payouts.disabled": "Otomatik ödeme bu kurulumda kapalı.",
    "payouts.notConnected": "Önce ödeme hesabını bağlaman gerekiyor.",

    "reg.notFound": "Kayıt bulunamadı.",
    "reg.alreadyCancelled": "Kayıt zaten iptal edilmiş.",
    "reg.refundWindow":
      "Etkinliğe 6 saatten az kaldığı için ücret iadesi yapılamıyor. " +
      "İptal için organizatörle iletişime geç.",
    "reg.refundFailed": "İade başarısız: {reason}",
  },

  en: {
    "common.notFound": "Not found.",
    "common.unknownError": "unknown error",
    "server.error": "Something went wrong on our side.",

    "rate.auth": "Too many attempts. Please try again in a little while.",
    "rate.pay": "Too many payment attempts. Please wait a moment.",

    "auth.required": "You need to sign in to do that.",
    "auth.sessionMissing": "Session not found.",
    "auth.ownerOnly": "This area is only open to the app owner.",
    "auth.nameLength": "Full name must be 2–60 characters.",
    "auth.invalidEmail": "Enter a valid email address.",
    "auth.passwordShort": "Password must be at least 8 characters.",
    "auth.emailTaken": "That email is already registered.",
    "auth.badCredentials": "Email or password is incorrect.",
    "auth.resetInvalid": "This link is invalid or has expired. Request a new one.",
    "auth.wrongPassword": "Wrong password.",
    "auth.ownerCannotDelete": "The app owner account cannot be deleted here.",
    "auth.hostHasEvents": "Cancel your published events first.",

    "event.notFound": "Event not found.",
    "event.cancelled": "This event has been cancelled.",
    "event.past": "This event has already taken place.",
    "event.ownEvent": "You are the host, so you are already on the list.",
    "event.alreadyJoined": "You are already going to this event.",
    "event.full": "This event is sold out.",
    "event.notOrganizer": "You are not the host of this event.",
    "event.alreadyCancelled": "This event is already cancelled.",
    "event.attendeesOrganizerOnly": "The attendee list is only open to the host.",
    "event.checkinOrganizerOnly": "Check-in is only open to the host.",

    "ticket.notFound": "No ticket matches that code.",
    "ticket.invalid": "This ticket is not valid ({status}).",
    "ticket.used": "This ticket has already been used.",

    "validate.title": "Title must be 3–120 characters.",
    "validate.city": "City is required.",
    "validate.date": "Pick a valid date and time.",
    "validate.futureDate": "The event date must be in the future.",
    "validate.capacity": "Capacity must be between 1 and 1000.",
    "validate.price": "Invalid price.",

    "payment.startFailed": "Could not start the payment: {reason}",
    "payment.notFound": "Payment not found.",
    "payment.notCompletable": "This payment can no longer be completed.",
    "payment.capacityFilled": "The event filled up in the meantime. You were not charged.",
    "payment.capacityFilledRefunded":
      "The event filled up in the meantime. Your payment has been refunded.",
    "payment.sessionMissing": "Payment session not found.",
    "payment.verifyFailed": "Could not verify the payment: {reason}",
    "payment.notPaid": "The payment has not been completed yet.",
    "payment.cardInvalid": "That card number is not valid.",
    "payment.expiryInvalid": "Expiry date must be in MM/YY format.",
    "payment.cvcInvalid": "That CVC is not valid.",
    "payment.holderRequired": "Enter the name on the card.",
    "payment.declined": "Card declined. Try another card.",

    "payouts.disabled": "Automatic payouts are switched off in this setup.",
    "payouts.notConnected": "Connect your payout account first.",

    "reg.notFound": "Registration not found.",
    "reg.alreadyCancelled": "This registration is already cancelled.",
    "reg.refundWindow":
      "Refunds are not available within 6 hours of the event. " +
      "Contact the host to cancel.",
    "reg.refundFailed": "Refund failed: {reason}",
  },
};

const SUPPORTED = Object.keys(DICT);
const FALLBACK = DICT[config.defaultLang] ? config.defaultLang : "tr";

/** İstekten dil kodunu çözer. */
function langOf(req) {
  if (!req) return FALLBACK;

  const fromQuery = req.query && String(req.query.lang || "").toLowerCase();
  if (fromQuery && DICT[fromQuery]) return fromQuery;

  const header = req.get ? req.get("X-Lang") : null;
  if (header) {
    const code = header.trim().toLowerCase().split("-")[0];
    if (DICT[code]) return code;
  }

  const accept = req.get ? req.get("Accept-Language") : null;
  if (accept) {
    for (const part of accept.split(",")) {
      const code = part.trim().split(";")[0].toLowerCase().split("-")[0];
      if (DICT[code]) return code;
    }
  }

  return FALLBACK;
}

/**
 * Çeviriyi döndürür. {isim} yer tutucuları params ile doldurulur.
 * Anahtar seçili dilde yoksa varsayılan dile, o da yoksa anahtarın kendisine düşer.
 */
function t(req, key, params) {
  const lang = typeof req === "string" ? req : langOf(req);
  const text = (DICT[lang] && DICT[lang][key]) || DICT[FALLBACK][key] || key;

  if (!params) return text;
  return text.replace(/\{(\w+)\}/g, (match, name) =>
    params[name] === undefined ? match : String(params[name]),
  );
}

module.exports = { t, langOf, SUPPORTED, FALLBACK, DICT };
