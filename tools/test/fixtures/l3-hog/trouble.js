// Runtime guard test (M2.2): 3 s after start, hold about 160 MB: 80 MB of typed arrays and 80 MB of JS heap.
window.__hog = [];
setTimeout(() => {
  for (let i = 0; i < 8; i++) { const a = new Uint8Array(10 * 1024 * 1024); a.fill(i + 1); window.__hog.push(a); }
  for (let i = 0; i < 10; i++) window.__hog.push(Array.from({ length: 1024 * 1024 }, (_, j) => j + i + 0.5));
}, 3000);
