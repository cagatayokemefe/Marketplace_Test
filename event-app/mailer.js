"use strict";

/**
 * E-posta gönderimi.
 *
 * SMTP_URL tanımlıysa gerçekten yollar; tanımlı değilse postayı konsola yazar.
 * Böylece geliştirirken bir posta sunucusu kurmadan içeriği görebilirsin ve
 * testler ağa çıkmaz.
 *
 * Gönderim hiçbir zaman isteği düşürmez: bir posta gidemezse hata loglanır,
 * kullanıcının işlemi yine tamamlanır. Bilet almak, postanın gitmesine bağlı
 * olmamalı.
 */

const nodemailer = require("nodemailer");
const config = require("./config");

const enabled = !!config.mail.smtpUrl;
const transport = enabled ? nodemailer.createTransport(config.mail.smtpUrl) : null;

// Test ve geliştirme sırasında son gönderilenleri tutar.
const outbox = [];

// ── Şablonlar ───────────────────────────────────────────────────────────────

const TEMPLATES = {
  joinConfirmed: {
    tr: {
      subject: "{title} · kaydın onaylandı",
      heading: "Kaydın onaylandı",
      lines: [
        "{title} etkinliğine kaydın tamam.",
        "**Tarih:** {when}",
        "**Yer:** {place}",
        "**Giriş kodun:** {code}",
        "Girişte bu kodu organizatöre göstermen yeterli.",
      ],
      cta: { label: "Biletimi aç", path: "/#/ticket/{registrationId}" },
    },
    en: {
      subject: "{title} · you're going",
      heading: "You're going",
      lines: [
        "Your spot at {title} is confirmed.",
        "**Date:** {when}",
        "**Where:** {place}",
        "**Entry code:** {code}",
        "Just show this code to the host at the door.",
      ],
      cta: { label: "Open my ticket", path: "/#/ticket/{registrationId}" },
    },
  },

  eventCancelled: {
    tr: {
      subject: "{title} iptal edildi",
      heading: "Etkinlik iptal edildi",
      lines: [
        "Organizatör {title} etkinliğini iptal etti.",
        "**Planlanan tarih:** {when}",
        "{refundLine}",
      ],
      cta: { label: "Başka etkinliklere bak", path: "/#/" },
    },
    en: {
      subject: "{title} has been cancelled",
      heading: "Event cancelled",
      lines: [
        "The host cancelled {title}.",
        "**Was scheduled for:** {when}",
        "{refundLine}",
      ],
      cta: { label: "Browse other events", path: "/#/" },
    },
  },

  registrationCancelled: {
    tr: {
      subject: "{title} · katılımın iptal edildi",
      heading: "Katılımın iptal edildi",
      lines: ["{title} etkinliğindeki yerini bıraktın.", "{refundLine}"],
      cta: { label: "Etkinliklere dön", path: "/#/" },
    },
    en: {
      subject: "{title} · your spot is cancelled",
      heading: "Your spot is cancelled",
      lines: ["You gave up your spot at {title}.", "{refundLine}"],
      cta: { label: "Back to events", path: "/#/" },
    },
  },

  reminder: {
    tr: {
      subject: "Yarın: {title}",
      heading: "Yarın görüşüyoruz",
      lines: [
        "{title} yaklaşıyor.",
        "**Tarih:** {when}",
        "**Yer:** {place}",
        "**Giriş kodun:** {code}",
      ],
      cta: { label: "Biletimi aç", path: "/#/ticket/{registrationId}" },
    },
    en: {
      subject: "Tomorrow: {title}",
      heading: "See you tomorrow",
      lines: [
        "{title} is coming up.",
        "**Date:** {when}",
        "**Where:** {place}",
        "**Entry code:** {code}",
      ],
      cta: { label: "Open my ticket", path: "/#/ticket/{registrationId}" },
    },
  },

  passwordReset: {
    tr: {
      subject: "Şifreni sıfırla",
      heading: "Şifre sıfırlama",
      lines: [
        "Şifreni sıfırlamak için aşağıdaki düğmeye bas. Bağlantı {hours} saat geçerli.",
        "Bu isteği sen yapmadıysan bu postayı yok sayabilirsin; şifren değişmez.",
      ],
      cta: { label: "Yeni şifre belirle", path: "/#/reset?token={token}" },
    },
    en: {
      subject: "Reset your password",
      heading: "Password reset",
      lines: [
        "Use the button below to set a new password. The link is valid for {hours} hours.",
        "If you did not ask for this, ignore this email — your password stays as it is.",
      ],
      cta: { label: "Set a new password", path: "/#/reset?token={token}" },
    },
  },
};

// ── Biçimlendirme ───────────────────────────────────────────────────────────

function fill(text, vars) {
  return String(text).replace(/\{(\w+)\}/g, (match, key) =>
    vars[key] === undefined ? match : String(vars[key]),
  );
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[c]);
}

/** **kalın** işaretlerini HTML'e çevirir; geri kalan her şey kaçışlanır. */
function inlineHtml(line) {
  return escapeHtml(line).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function plainText(line) {
  return line.replace(/\*\*(.+?)\*\*/g, "$1");
}

function renderHtml({ heading, lines, cta, baseUrl }) {
  const body = lines
    .filter(Boolean)
    .map((l) => `<p style="margin:0 0 14px">${inlineHtml(l)}</p>`)
    .join("");

  const button = cta
    ? `<p style="margin:26px 0 0">
         <a href="${escapeHtml(baseUrl + cta.path)}"
            style="display:inline-block;padding:12px 22px;border-radius:10px;
                   background:#e11d48;color:#ffffff;text-decoration:none;
                   font-weight:600">${escapeHtml(cta.label)}</a>
       </p>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;background:#f6f7fb;padding:24px;
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
  color:#10131c;line-height:1.6">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;
              padding:28px;border:1px solid #e2e6f0">
    <h1 style="margin:0 0 18px;font-size:1.35rem">${escapeHtml(heading)}</h1>
    ${body}
    ${button}
  </div>
  <p style="max-width:520px;margin:16px auto 0;color:#98a2b3;font-size:12px">
    ${escapeHtml(config.owner.name)}
  </p>
</body></html>`;
}

// ── Gönderim ────────────────────────────────────────────────────────────────

/**
 * Bir şablonu gönderir.
 *
 * @param {string} template - TEMPLATES anahtarı
 * @param {object} to - { email, name, lang }
 * @param {object} vars - şablondaki {yer_tutucu} değerleri
 * @param {string} baseUrl - bağlantıların önüne gelecek adres
 */
async function send(template, to, vars, baseUrl) {
  const spec = TEMPLATES[template];
  if (!spec) throw new Error("Bilinmeyen posta şablonu: " + template);

  const lang = spec[to.lang] ? to.lang : "tr";
  const shape = spec[lang];
  const url = (baseUrl || config.publicUrl || "").replace(/\/$/, "");

  const subject = fill(shape.subject, vars);
  const lines = shape.lines.map((l) => fill(l, vars)).filter((l) => l.trim());
  const cta = shape.cta
    ? { label: shape.cta.label, path: fill(shape.cta.path, vars) }
    : null;

  const message = {
    from: config.mail.from,
    to: to.name ? `${to.name} <${to.email}>` : to.email,
    subject,
    text:
      lines.map(plainText).join("\n\n") +
      (cta ? `\n\n${cta.label}: ${url + cta.path}` : ""),
    html: renderHtml({ heading: shape.heading, lines, cta, baseUrl: url }),
  };

  outbox.push({ template, to: to.email, subject, at: new Date().toISOString() });
  if (outbox.length > 50) outbox.shift();

  if (!enabled) {
    console.log(
      `\n── E-POSTA (gönderilmedi, SMTP_URL yok) ─────────────────\n` +
        `  Kime  : ${message.to}\n  Konu  : ${subject}\n` +
        message.text
          .split("\n")
          .map((l) => "  " + l)
          .join("\n") +
        `\n─────────────────────────────────────────────────────────\n`,
    );
    return { sent: false, logged: true };
  }

  await transport.sendMail(message);
  return { sent: true };
}

/** İsteği düşürmeden gönderir: posta gidemezse yalnızca loglanır. */
function sendQuietly(template, to, vars, baseUrl) {
  if (!to || !to.email) return Promise.resolve({ sent: false });
  return send(template, to, vars, baseUrl).catch((err) => {
    console.error("E-posta gönderilemedi (" + template + "):", err.message);
    return { sent: false, error: err.message };
  });
}

module.exports = {
  enabled,
  send,
  sendQuietly,
  outbox,
  TEMPLATES,
};
