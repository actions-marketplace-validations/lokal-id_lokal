// Draws docs/assets/demo.svg (and demo.id.svg): an animated terminal that shows an agent reading a customer CSV
// without Lokal, then with it. Plain SVG and CSS, so GitHub renders it in the README; with reduced motion it shows
// every line at once. The data is made up.
//
//   node scripts/make-demo-svg.mjs
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const COPY = {
  en: {
    title: 'claude — ~/toko-online',
    without: 'Without Lokal',
    with: 'With Lokal',
    prompt: 'why does the import of pelanggan.csv fail?',
    leak: '↑ sent to the model provider as it is',
    answer: 'Row 2 has a phone number in the nik column. Fixing it.',
    restored: '✓ real values written back on your machine; the model never saw them',
    alt: 'Animated terminal. Without Lokal, an AI agent reads pelanggan.csv and the real names, NIK numbers, and phone numbers go to the model provider. With Lokal, the agent reads the same file through read_file_masked and sees [NAME_1], [NIK_1], and [PHONE_1], finds the bad row, and writes the fix with write_file_unmasked, which puts the real values back on the machine.',
  },
  id: {
    title: 'claude — ~/toko-online',
    without: 'Tanpa Lokal',
    with: 'Dengan Lokal',
    prompt: 'kenapa import pelanggan.csv gagal?',
    leak: '↑ terkirim apa adanya ke penyedia model',
    answer: 'Baris 2 berisi nomor HP di kolom nik. Saya perbaiki.',
    restored: '✓ nilai asli ditulis kembali di komputermu; model tidak pernah melihatnya',
    alt: 'Terminal animasi. Tanpa Lokal, agent AI membaca pelanggan.csv dan nama, NIK, serta nomor HP asli terkirim ke penyedia model. Dengan Lokal, agent membaca file yang sama lewat read_file_masked dan hanya melihat [NAME_1], [NIK_1], dan [PHONE_1], menemukan baris yang salah, lalu menulis perbaikannya dengan write_file_unmasked yang memulihkan nilai asli di komputer.',
  },
};

const W = 920;
const LINE = 24;
const CYCLE = 16; // seconds

function svg(lang) {
  const t = COPY[lang];
  // [kind, text, indent]; kinds pick the color. Each line appears in turn and the whole thing loops.
  const lines = [
    ['label-bad', t.without],
    ['prompt', `> ${t.prompt}`],
    ['tool', '● Read(pelanggan.csv)'],
    ['dim', 'nama,nik,telepon', 1],
    ['leak', 'Budi Santoso,3201011508950001,0812-3456-7890', 1],
    ['leak', 'Siti Aminah,081398765432,3276014503920002', 1],
    ['warn', t.leak, 1],
    ['gap', ''],
    ['label-good', t.with],
    ['prompt', `> ${t.prompt}`],
    ['tool', '● lokal · read_file_masked(pelanggan.csv)'],
    ['dim', 'nama,nik,telepon', 1],
    ['masked', '[NAME_1],[NIK_1],[PHONE_1]', 1],
    ['masked', '[NAME_2],[PHONE_2],[NIK_2]', 1],
    ['text', `● ${t.answer}`],
    ['tool', '● lokal · write_file_unmasked(pelanggan.csv)'],
    ['ok', t.restored, 1],
  ];
  const top = 64;
  const H = top + lines.length * LINE + 28;
  const step = (CYCLE * 0.72) / lines.length;
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const keyframes = [];
  const body = lines
    .map(([kind, text, indent = 0], i) => {
      if (kind === 'gap') return '';
      const appear = ((i * step) / CYCLE) * 100;
      keyframes.push(
        `@keyframes l${i}{0%,${appear.toFixed(2)}%{opacity:0;transform:translateY(4px)}${(appear + 1.5).toFixed(2)}%,94%{opacity:1;transform:none}100%{opacity:0}}`,
      );
      const y = top + i * LINE;
      const x = 28 + indent * 22;
      const style = `animation:l${i} ${CYCLE}s linear infinite`;
      if (kind === 'label-bad' || kind === 'label-good') {
        const color = kind === 'label-bad' ? 'var(--bad)' : 'var(--good)';
        return `<g class="ln" style="${style}"><circle cx="${x + 5}" cy="${y - 5}" r="5" fill="${color}"/><text x="${x + 18}" y="${y}" class="label" fill="${color}">${esc(text)}</text></g>`;
      }
      if (kind === 'leak' || kind === 'masked') {
        const width = text.length * 7.8 + 12;
        const bg = kind === 'leak' ? 'var(--bad-bg)' : 'var(--good-bg)';
        return `<g class="ln" style="${style}"><rect x="${x - 6}" y="${y - 17}" width="${width.toFixed(0)}" height="23" rx="4" fill="${bg}"/><text x="${x}" y="${y}" class="${kind}">${esc(text)}</text></g>`;
      }
      return `<text x="${x}" y="${y}" class="ln ${kind}" style="${style}">${esc(text)}</text>`;
    })
    .join('\n  ');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(t.alt)}">
<title>${esc(t.alt)}</title>
<style>
:root{--bg:#0d1117;--bar:#161b22;--fg:#e6edf3;--dim:#8b949e;--tool:#d2a8ff;--bad:#ff7b72;--bad-bg:rgba(248,81,73,.16);--good:#3fb950;--good-bg:rgba(63,185,80,.14);--warn:#ffa657}
text{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace;font-size:14px;fill:var(--fg)}
.label{font-weight:700;letter-spacing:.02em}.prompt{fill:#79c0ff}.tool{fill:var(--tool)}.dim{fill:var(--dim)}
.leak{fill:#ffa198}.masked{fill:#7ee787}.warn{fill:var(--warn)}.ok{fill:var(--good)}.text{fill:var(--fg)}
.ln{opacity:0}
${keyframes.join('\n')}
@media (prefers-reduced-motion:reduce){.ln{animation:none!important;opacity:1}}
</style>
<rect width="${W}" height="${H}" rx="12" fill="var(--bg)"/>
<path d="M0 12a12 12 0 0 1 12-12h${W - 24}a12 12 0 0 1 12 12v24H0z" fill="var(--bar)"/>
<circle cx="22" cy="18" r="6" fill="#ff5f57"/><circle cx="42" cy="18" r="6" fill="#febc2e"/><circle cx="62" cy="18" r="6" fill="#28c840"/>
<text x="${W / 2}" y="23" text-anchor="middle" class="dim" style="font-size:13px">${esc(t.title)}</text>
  ${body}
</svg>
`;
}

for (const [lang, file] of [['en', 'demo.svg'], ['id', 'demo.id.svg']]) {
  writeFileSync(path.join(ROOT, 'docs/assets', file), svg(lang));
  console.log(`docs/assets/${file}`);
}
