"use strict";

/**
 * Uygulama ikonlarını koddan üretir (harici bağımlılık yok).
 * Bilet biçimli beyaz bir işaret + degrade arka plan.
 *
 *   node tools/make-icons.js
 */

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

// ── Minimal PNG yazıcı ──────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit derinliği
  ihdr[9] = 6; // renk tipi: RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  // Her satırın başına filtre baytı (0 = None)
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Çizim ───────────────────────────────────────────────────────────────────

const ACCENT = [225, 29, 72]; // #e11d48
const WARM = [255, 138, 91]; // #ff8a5b

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** Yuvarlatılmış dikdörtgenin içinde mi? */
function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

/**
 * Tek bir alt-örnek için renk döndürür.
 * @returns {[r,g,b,a]}
 */
function sample(x, y, size, maskable) {
  const bgRadius = maskable ? 0 : size * 0.22;
  const inside = maskable
    ? true
    : inRoundRect(x, y, 0, 0, size, size, bgRadius);

  if (!inside) return [0, 0, 0, 0];

  const t = (x / size + y / size) / 2;
  const bg = mix(ACCENT, WARM, t);

  // Bilet gövdesi
  const tx0 = size * 0.24;
  const tx1 = size * 0.76;
  const ty0 = size * 0.34;
  const ty1 = size * 0.66;
  const ticketR = size * 0.055;
  const notchR = size * 0.05;
  const midY = (ty0 + ty1) / 2;

  const inTicket = inRoundRect(x, y, tx0, ty0, tx1, ty1, ticketR);
  if (!inTicket) return [bg[0], bg[1], bg[2], 255];

  // Yanlardaki yarım daire çentikler
  const dLeft = Math.hypot(x - tx0, y - midY);
  const dRight = Math.hypot(x - tx1, y - midY);
  if (dLeft <= notchR || dRight <= notchR) return [bg[0], bg[1], bg[2], 255];

  // Ortadaki kesik çizgi
  const dashW = size * 0.012;
  if (Math.abs(x - size * 0.5) <= dashW / 2) {
    const period = size * 0.052;
    const phase = Math.floor((y - ty0) / period);
    if (phase % 2 === 0) return [bg[0], bg[1], bg[2], 255];
  }

  return [255, 255, 255, 255];
}

function renderIcon(size, maskable) {
  const SS = 3; // kenar yumuşatma için alt-örnekleme
  const out = Buffer.alloc(size * size * 4);

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const c = sample(
            px + (sx + 0.5) / SS,
            py + (sy + 0.5) / SS,
            size,
            maskable,
          );
          r += c[0] * c[3];
          g += c[1] * c[3];
          b += c[2] * c[3];
          a += c[3];
        }
      }
      const i = (py * size + px) * 4;
      if (a === 0) {
        out[i] = out[i + 1] = out[i + 2] = out[i + 3] = 0;
      } else {
        out[i] = Math.round(r / a);
        out[i + 1] = Math.round(g / a);
        out[i + 2] = Math.round(b / a);
        out[i + 3] = Math.round(a / (SS * SS));
      }
    }
  }
  return encodePng(size, size, out);
}

// ── Üret ────────────────────────────────────────────────────────────────────

const outDir = path.join(__dirname, "..", "public", "icons");
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { file: "icon-192.png", size: 192, maskable: false },
  { file: "icon-512.png", size: 512, maskable: false },
  { file: "icon-180.png", size: 180, maskable: true }, // iOS zaten kendi maskesini uygular
  { file: "maskable-512.png", size: 512, maskable: true },
];

for (const t of targets) {
  const png = renderIcon(t.size, t.maskable);
  fs.writeFileSync(path.join(outDir, t.file), png);
  console.log("✓", t.file, "(" + t.size + "px, " + png.length + " bayt)");
}
