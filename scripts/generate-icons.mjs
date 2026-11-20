// Draws the app icon (four rounded tiles on a blue square) as PNG + ICO without extra dependencies.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const out = path.join(import.meta.dirname, '..', 'build', 'icons');
fs.mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function inside(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px > x1 || py < y0 || py > y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r); const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return Math.hypot(px - cx, py - cy) <= r;
}
function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const i = y * (size * 4 + 1) + 1 + x * 4;
      let [R, G, B, A] = [0, 0, 0, 0];
      // Rounded blue square with a 2 x 2 grid of light tiles (one accent tile).
      const inset = size * 0.04; const rad = size * 0.2;
      if (inside(x + 0.5, y + 0.5, inset, inset, size - inset, size - inset, rad)) {
        [R, G, B, A] = [36, 87, 197, 255];
        const g = size * 0.17; const gap = size * 0.07; const cell = (size - 2 * g - gap) / 2; const r2 = size * 0.06;
        for (let ty = 0; ty < 2; ty += 1) for (let tx = 0; tx < 2; tx += 1) {
          const x0 = g + tx * (cell + gap); const y0 = g + ty * (cell + gap);
          if (inside(x + 0.5, y + 0.5, x0, y0, x0 + cell, y0 + cell, r2)) [R, G, B] = tx === 1 && ty === 0 ? [255, 200, 87] : [230, 238, 255];
        }
      }
      raw[i] = R; raw[i + 1] = G; raw[i + 2] = B; raw[i + 3] = A;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map(png);
const header = Buffer.alloc(6); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
let offset = 6 + 16 * sizes.length;
const entries = sizes.map((s, i) => {
  const e = Buffer.alloc(16);
  e[0] = s === 256 ? 0 : s; e[1] = s === 256 ? 0 : s; e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(images[i].length, 8); e.writeUInt32LE(offset, 12); offset += images[i].length;
  return e;
});
fs.writeFileSync(path.join(out, 'icon.ico'), Buffer.concat([header, ...entries, ...images]));
fs.writeFileSync(path.join(out, 'icon.png'), images.at(-1));
console.log(`Icons written to ${out}`);
