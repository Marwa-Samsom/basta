/**
 * أيقونات التطبيق (PWA) — تُولَّد من رسم واحد بألوان الهوية، فلا ملف صورة
 * يُرسم يدوياً ويخرج عن النظام. تشغيل: node apps/api/scripts/make-icons.cjs
 */
const sharp = require('sharp');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');

const OUT = join(__dirname, '..', '..', 'web', 'public', 'icons');
mkdirSync(OUT, { recursive: true });
const BRAND = process.argv[2];
const BEIGE = process.argv[3];

// «بسطة»: مظلّة سوق فوق بسطة — أشكال لا خطّ، فتظهر كما هي على كل جهاز
const mark = (size, pad) => {
  const s = size, p = pad, w = s - 2 * p;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" rx="${pad ? 0 : s * 0.22}" fill="${BRAND}"/>
  <path d="M${p + w * 0.12} ${p + w * 0.42} L${p + w * 0.5} ${p + w * 0.16} L${p + w * 0.88} ${p + w * 0.42} Z" fill="${BEIGE}"/>
  <path d="M${p + w * 0.12} ${p + w * 0.42} q${w * 0.095} ${w * 0.1} ${w * 0.19} 0 q${w * 0.095} ${w * 0.1} ${w * 0.19} 0 q${w * 0.095} ${w * 0.1} ${w * 0.19} 0 q${w * 0.095} ${w * 0.1} ${w * 0.19} 0" fill="none" stroke="${BEIGE}" stroke-width="${w * 0.035}"/>
  <rect x="${p + w * 0.2}" y="${p + w * 0.62}" width="${w * 0.6}" height="${w * 0.08}" rx="${w * 0.02}" fill="${BEIGE}"/>
  <rect x="${p + w * 0.26}" y="${p + w * 0.7}" width="${w * 0.05}" height="${w * 0.16}" fill="${BEIGE}"/>
  <rect x="${p + w * 0.69}" y="${p + w * 0.7}" width="${w * 0.05}" height="${w * 0.16}" fill="${BEIGE}"/>
</svg>`;
};

(async () => {
  for (const [name, size, pad] of [['icon-192.png', 192, 0], ['icon-512.png', 512, 0], ['maskable-512.png', 512, 80], ['apple-touch-icon.png', 180, 0]]) {
    await sharp(Buffer.from(mark(size, pad))).png().toFile(join(OUT, name));
  }
  console.log('icons →', OUT);
})();
