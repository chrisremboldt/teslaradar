import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function crc32(buffer) {
  let crc = ~0;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const tag = Buffer.from(type);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([tag, data])));
  return Buffer.concat([length, tag, data, crc]);
}

function png(size, colorAt) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x += 1) {
      const [r, g, b, a] = colorAt(x, y, size);
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      raw[offset] = r;
      raw[offset + 1] = g;
      raw[offset + 2] = b;
      raw[offset + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function iconColor(x, y, size) {
  const nx = (x + 0.5) / size - 0.5;
  const ny = (y + 0.5) / size - 0.5;
  const r = Math.hypot(nx, ny);
  if (r > 0.46) return [0, 0, 0, 0];
  if (r > 0.42) return [11, 13, 16, 255];
  const angle = Math.atan2(ny, nx);
  const sweep = Math.abs(angle + Math.PI / 2) < 0.35 && r > 0.08 && r < 0.36;
  if (sweep) return [244, 63, 94, 255];
  if (r < 0.07) return [56, 189, 248, 255];
  return [11, 13, 16, 255];
}

for (const size of [192, 512]) {
  writeFileSync(join(root, "public", `icon-${size}.png`), png(size, iconColor));
}

console.log("Wrote public/icon-192.png and public/icon-512.png");
