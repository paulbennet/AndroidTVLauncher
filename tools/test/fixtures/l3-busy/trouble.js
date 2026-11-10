// Runtime guard test (M2.2): 4 s after start, block the renderer's main thread for good.
// In WebView the frame shares the core's thread, so the core stops too; only the native watchdog gets out.
setTimeout(() => { for (;;) { /* busy */ } }, 4000);
