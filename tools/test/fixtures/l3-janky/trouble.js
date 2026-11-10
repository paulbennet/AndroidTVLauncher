// Runtime guard test (M2.2): after every focus move, 400 ms of frames that each take 40 ms of script (~10 janky frames
// per key press, far over the guard's limit of 3). Three such 10 s windows in a row turn the skin off.
lx.on('focus', () => {
  const end = performance.now() + 400;
  const frame = () => {
    const t = performance.now() + 40;
    while (performance.now() < t) { /* busy */ }
    document.body.style.setProperty('--jank', String(Math.random())); // something to draw
    if (performance.now() < end) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
});
