// 无损图片压缩:用 Electron nativeImage 缩放到指定长边,再对 PNG 的 IDAT 做
// zlib 最大压缩(level 9)。不引原生依赖。任何解析失败都回退到缩放后的原名,
// 绝不抛错(压缩是锦上添花,不能被它阻断上传)。

import { nativeImage } from 'electron';
import zlib from 'node:zlib';

export type CompressOptions = {
  // 长边上限(像素),超过则等比缩小;默认 1000。
  maxEdge?: number;
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// 保持宽高比,长边不超过 maxEdge。
function fitWidth(src: { width: number; height: number }, maxEdge: number) {
  const { width, height } = src;
  const scale = Math.min(1, maxEdge / Math.max(width, height, 1));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function compressPng(buffer: Buffer, opts: CompressOptions = {}): Buffer {
  const maxEdge = opts.maxEdge ?? 1000;
  try {
    const img = nativeImage.createFromBuffer(buffer);
    if (img.isEmpty()) return buffer;
    const size = img.getSize();
    if (size.width <= 0 || size.height <= 0) return buffer;
    const target = fitWidth(size, maxEdge);
    const resized = target.width === size.width && target.height === size.height
      ? img.toPNG()
      : img.resize({ width: target.width, height: target.height }).toPNG();
    const recompressed = recompressPng(resized);
    // 重压缩必须仍能解码(不产生坏图),否则保留缩放后的版本。
    return nativeImage.createFromBuffer(recompressed).isEmpty() ? resized : recompressed;
  } catch {
    return buffer;
  }
}

// 对 PNG 只重压缩 IDAT,其余 chunk(IHDR/PLTE/tRNS 等)按原样保留。
function recompressPng(buf: Buffer): Buffer {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) return buf;
  let pos = 8;
  const chunks: Array<{ type: string; data: Buffer }> = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    if (pos + 12 + len > buf.length) break;
    chunks.push({ type: buf.toString('ascii', pos + 4, pos + 8), data: Buffer.from(buf.subarray(pos + 8, pos + 8 + len)) });
    pos += 12 + len;
  }
  const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
  if (idat.length === 0) return buf;

  let scanlines: Buffer;
  try {
    scanlines = zlib.inflateSync(idat);
  } catch {
    return buf;
  }
  let newIdat: Buffer;
  try {
    newIdat = zlib.deflateSync(scanlines, { level: 9 });
  } catch {
    return buf;
  }

  const out: Buffer[] = [buf.subarray(0, 8)];
  for (const c of chunks) {
    if (c.type !== 'IDAT') out.push(encodeChunk(c.type, c.data));
  }
  out.push(encodeChunk('IDAT', newIdat));
  out.push(encodeChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(out);
}

function encodeChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
