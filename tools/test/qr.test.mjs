// QR encoder of the "Install skin" screen (core/qr.js), decoded with jsQR. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { qrMatrix } from '../../app/src/main/assets/web/core/qr.js';

function decode(text, scale = 4) {
  const m = qrMatrix(text), n = (m.length + 8) * scale;
  const px = new Uint8ClampedArray(n * n * 4).fill(255);
  m.forEach((row, y) => row.forEach((dark, x) => {
    if (!dark) return;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const i = (((y + 4) * scale + dy) * n + (x + 4) * scale + dx) * 4;
      px[i] = px[i + 1] = px[i + 2] = 0;
    }
  }));
  return { size: m.length, text: jsQR(px, n, n)?.data };
}

test('QR codes decode, versions 1–6', () => {
  for (const s of ['http://192.168.1.20:7190/', 'x', 'http://10.0.0.5:7190/', 'a'.repeat(40), 'b'.repeat(70), 'https://example.com/' + 'c'.repeat(80)]) {
    const r = decode(s);
    assert.equal(r.text, s, `size ${r.size}`);
  }
  assert.equal(decode('http://192.168.1.20:7190/').size, 25, 'a LAN address fits version 2');
  assert.throws(() => qrMatrix('d'.repeat(200)), /too long/);
});
