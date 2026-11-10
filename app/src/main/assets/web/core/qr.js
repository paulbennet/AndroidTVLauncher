// QR code encoder for the "Install skin" screen (plan M2.3): the TV shows its LAN page address so a phone can
// scan it. Byte mode, error correction level M, versions 1–6 (up to 106 bytes), no dependencies.
// Follows ISO/IEC 18004 as laid out in Project Nayuki's reference encoder (MIT), reduced to what we need.

const ECC_PER_BLOCK = [0, 10, 16, 26, 18, 24, 16]; // level M, by version
const BLOCKS = [0, 1, 1, 1, 2, 2, 4];
const FORMAT_M = 0; // level M's format bits

function rawModules(ver) {
  let r = (16 * ver + 128) * ver + 64;
  if (ver >= 2) { const n = Math.floor(ver / 7) + 2; r -= (25 * n - 10) * n - 55; }
  return r;
}
const dataCodewords = ver => Math.floor(rawModules(ver) / 8) - ECC_PER_BLOCK[ver] * BLOCKS[ver];

// ---------------------------------------------------------------- Reed–Solomon over GF(256), polynomial 0x11D
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; }
  return z;
}
function rsDivisor(degree) {
  const r = new Array(degree).fill(0);
  r[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < r.length; j++) { r[j] = gfMul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
    root = gfMul(root, 0x02);
  }
  return r;
}
function rsRemainder(data, divisor) {
  const r = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ r.shift();
    r.push(0);
    divisor.forEach((coef, i) => { r[i] ^= gfMul(coef, factor); });
  }
  return r;
}

// ---------------------------------------------------------------- encoding
function codewords(bytes, ver) {
  const bits = [];
  const put = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  put(0b0100, 4);           // byte mode
  put(bytes.length, 8);     // character count (8 bits for versions 1–9)
  for (const b of bytes) put(b, 8);
  const capacity = dataCodewords(ver) * 8;
  put(0, Math.min(4, capacity - bits.length)); // terminator
  put(0, (8 - (bits.length % 8)) % 8);
  const data = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((a, b) => (a << 1) | b, 0));
  for (let pad = 0xec; data.length < dataCodewords(ver); pad ^= 0xec ^ 0x11) data.push(pad);

  // Split into blocks, add error correction, interleave.
  const numBlocks = BLOCKS[ver], eccLen = ECC_PER_BLOCK[ver];
  const raw = Math.floor(rawModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks), shortLen = Math.floor(raw / numBlocks);
  const div = rsDivisor(eccLen);
  const blocks = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1));
    k += dat.length;
    const ecc = rsRemainder(dat, div);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const out = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((b, j) => { if (i !== shortLen - eccLen || j >= numShort) out.push(b[i]); });
  }
  return out;
}

const MASKS = [
  (x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, x => x % 3 === 0, (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

function build(ver, data, mask) {
  const size = ver * 4 + 17;
  const m = Array.from({ length: size }, () => new Array(size).fill(false));
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const set = (x, y, dark) => { m[y][x] = dark; fn[y][x] = true; };

  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); } // timing
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  };
  finder(3, 3); finder(size - 4, 3); finder(3, size - 4);
  if (ver >= 2) { // one alignment pattern for versions 2–6
    const c = size - 7;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(c + dx, c + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  }
  // Format bits (reserved now, written after masking).
  const format = (() => {
    const d = (FORMAT_M << 3) | mask;
    let rem = d;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((d << 10) | rem) ^ 0x5412;
  })();
  const bit = i => ((format >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true); // always dark

  // Data in the zigzag order, then the mask on non-function modules.
  let i = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j, upward = ((right + 1) & 2) === 0, y = upward ? size - 1 - vert : vert;
        if (!fn[y][x] && i < data.length * 8) { m[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1; i++; }
      }
    }
  }
  const test = MASKS[mask];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (!fn[y][x] && test(x, y)) m[y][x] = !m[y][x];
  return m;
}

/** Lower is better (rules 1, 2 and 4 of the standard; any mask gives a valid code). */
function penalty(m) {
  const size = m.length;
  let p = 0;
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      for (let b = 1; b < size; b++) {
        const cur = pass ? m[b][a] : m[a][b], prev = pass ? m[b - 1][a] : m[a][b - 1];
        if (cur === prev) { run++; if (run === 5) p += 3; else if (run > 5) p++; } else run = 1;
      }
    }
  }
  let dark = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (m[y][x]) dark++;
    if (x < size - 1 && y < size - 1 && m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3;
  }
  return p + Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10;
}

/** text → square boolean matrix (true = dark), without the quiet zone. */
export function qrMatrix(text) {
  const bytes = Array.from(new TextEncoder().encode(text));
  const ver = [1, 2, 3, 4, 5, 6].find(v => bytes.length + 2 <= dataCodewords(v));
  if (!ver) throw new Error('QR: text too long');
  const data = codewords(bytes, ver);
  let best = null, bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const m = build(ver, data, mask), s = penalty(m);
    if (s < bestScore) { best = m; bestScore = s; }
  }
  return best;
}

/** An <svg> element for `text`, with a 4-module quiet zone. */
export function qrSvg(text) {
  const m = qrMatrix(text), n = m.length + 8;
  let d = '';
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + 4} ${y + 4}h1v1h-1z`; }));
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${n} ${n}`);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.innerHTML = `<rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${d}"/>`;
  return svg;
}
