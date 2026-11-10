// Static server for previewing the launcher UI in a desktop browser (uses mock.js).
//   PORT=5173            listen port
//   SKINS_DIR=<dir>      extra skins folder (each subfolder is a skin), listed as source "dev"
import { startServer } from './lib/server.mjs';

const port = Number(process.env.PORT || 5173);
const skinFolders = process.env.SKINS_DIR ? [{ dir: process.env.SKINS_DIR, source: 'dev' }] : [];
const { url } = await startServer({ port, skinFolders });
console.log(`Launcher preview on ${url}` + (skinFolders.length ? ` (dev skins: ${process.env.SKINS_DIR})` : ''));
