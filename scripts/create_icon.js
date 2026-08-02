const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outDir = path.join(root, "desktop", "assets");
const outFile = path.join(outDir, "icon.ico");

fs.mkdirSync(outDir, { recursive: true });

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(buffer) {
  let a = 1;
  let b = 0;
  for (const byte of buffer) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function zlibStore(data) {
  const blocks = [];
  for (let offset = 0; offset < data.length; offset += 65535) {
    const chunk = data.subarray(offset, Math.min(offset + 65535, data.length));
    const header = Buffer.alloc(5);
    header[0] = offset + chunk.length >= data.length ? 1 : 0;
    header.writeUInt16LE(chunk.length, 1);
    header.writeUInt16LE((~chunk.length) & 0xffff, 3);
    blocks.push(header, chunk);
  }
  const zlibHeader = Buffer.from([0x78, 0x01]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(adler32(data), 0);
  return Buffer.concat([zlibHeader, ...blocks, checksum]);
}

function makePng(size) {
  const rows = [];
  const center = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0;
    for (let x = 0; x < size; x++) {
      const i = 1 + x * 4;
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const ring = Math.abs(distance - 0.58) < 0.09;
      const bolt = Math.abs(x - y * 0.72 - size * 0.12) < size * 0.08 && y > size * 0.18 && y < size * 0.82;
      const glow = Math.max(0, 1 - distance);
      row[i] = ring || bolt ? 245 : Math.round(20 + 38 * glow);
      row[i + 1] = ring || bolt ? 171 : Math.round(75 + 82 * glow);
      row[i + 2] = ring || bolt ? 35 : Math.round(95 + 98 * glow);
      row[i + 3] = distance <= 0.92 ? 255 : 0;
    }
    rows.push(row);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", zlibStore(Buffer.concat(rows))),
    pngChunk("IEND", Buffer.alloc(0))
  ]);
  return png;
}

const entries = [16, 32, 48, 64, 128, 256].map(makePng);
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(entries.length, 4);

let offset = 6 + entries.length * 16;
const directory = entries.map((png) => {
  const dir = Buffer.alloc(16);
  const size = Math.round(Math.sqrt((png.length - 100) / 4)) || 0;
  const iconSize = entries.indexOf(png) === entries.length - 1 ? 0 : [16, 32, 48, 64, 128][entries.indexOf(png)];
  dir[0] = iconSize;
  dir[1] = iconSize;
  dir[2] = 0;
  dir[3] = 0;
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32LE(png.length, 8);
  dir.writeUInt32LE(offset, 12);
  offset += png.length;
  return dir;
});

fs.writeFileSync(outFile, Buffer.concat([header, ...directory, ...entries]));
const outPngFile = path.join(outDir, "icon.png");
fs.writeFileSync(outPngFile, makePng(512));
console.log(outFile);
console.log(outPngFile);
