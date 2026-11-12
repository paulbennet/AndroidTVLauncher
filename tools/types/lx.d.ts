// Types for Web TV Launcher skins (skin API v1). No build step: editors read these through JSDoc.
//
// Level 3 skin.js:   // @ts-check
//                    /// <reference path="./lx.d.ts" />
// manifest.json:     "$schema" is not needed; `lx lint` checks it. The LxSkin.Manifest type documents it.
//
// `lx new` copies this file into a new skin. `lx pack`, `lx install` and `lx push` leave it out of the package.

declare namespace LxSkin {
  /** One app, as the core sends it to a level 3 page. Only ids from `data` can be focused, opened or reported. */
  interface App {
    /** Package name. Use it as `data-item="<id>"`. */
    id: string;
    label: string;
    /** True when `image` is a 16:9 TV banner; false when it is a square icon (or null). */
    banner: boolean;
    /** URL on the skin host (banner or icon), or null when the app has neither. */
    image: string | null;
    /** The app is in Favourites. */
    fav: boolean;
  }

  /** A TV input (HDMI, AV, the tuner). OK on an element with `data-item="<id>"` opens it on the TV. */
  interface Input {
    /** "input:" + the TV's input id. */
    id: string;
    label: string;
    kind: 'hdmi' | 'av' | 'tuner' | 'other';
    /** False when the TV reports nothing connected. */
    connected: boolean;
  }

  /** `lx.on('data')`: sent at start and on every change (apps installed, favourites moved, hidden apps…). */
  interface Data {
    /** All visible apps, in the core's order. */
    apps: App[];
    favourites: App[];
    /** Recently opened apps, newest first (launches from this launcher only); also in `apps`. */
    recent: App[];
    /** TV inputs; empty when the device has none (and while benching). */
    inputs: Input[];
    /** Id of the favourite being moved (OK held, then left/right), or null. Focus follows it in `[data-list=favourites]`. */
    moving: string | null;
    /** Number of apps the user hid (0 while "Show hidden apps" is on). */
    hiddenCount: number;
  }

  /** Values of the manifest's `options`, by option id (also on `html[data-opt-*]` and `--lx-opt-*`). */
  type Options = Record<string, boolean | number | string>;

  interface Events {
    data: Data;
    /** The newly focused element (it also has the `[focused]` attribute). */
    focus: HTMLElement;
    options: Options;
    /** Home or Back: focus is already back on the first item and lists are scrolled to the start. */
    home: undefined;
    /** The launcher is in front again. */
    resume: undefined;
    /** OK was pressed on an app or input: the core opens it right after this event (the id from `data`). */
    launch: string;
    /** True when the launcher page is hidden. */
    visibility: boolean;
  }

  interface Api {
    /** Skin API version (1). */
    readonly version: number;
    on<K extends keyof Events>(type: K, fn: (arg: Events[K]) => void): void;
    /** Re-applies the focus after you re-rendered outside a `data` handler. */
    refresh(): void;
    /** The last `data` message, or null before the first one. */
    readonly data: Data | null;
    /** The focused element, or null. */
    readonly focused: HTMLElement | null;
  }

  // ---------------------------------------------------------------- manifest.json (all levels)
  type Level = 0 | 1 | 2 | 3;

  /** Design tokens (level 0+). Lengths are CSS lengths; 1rem = 1/96 of the screen width. */
  interface Tokens {
    bg?: string; bg2?: string; bg3?: string; glow?: string; text?: string; textDim?: string;
    card?: string; accent?: string; onAccent?: string; ring?: string; moving?: string;
    radius?: string; gap?: string; padX?: string; tileWidth?: string; ringWidth?: string;
    /** 1–1.3 */
    focusScale?: number;
    /** 1–12 */
    gridColumns?: number;
    font?: string;
    /** Relative path to an image in the package. */
    wallpaper?: string;
  }

  type Option =
    | { id: string; type: 'toggle'; label: string; default?: boolean }
    | { id: string; type: 'choice'; label: string; choices: Array<{ value: string; label: string }>; default?: string }
    | { id: string; type: 'color'; label: string; choices: Array<{ value: string; label: string }>; default?: string }
    | { id: string; type: 'range'; label: string; min: number; max: number; step?: number; default?: number };

  interface Manifest {
    /** Lowercase letters, digits and "-", max 40. The folder name must be the same. */
    id: string;
    name: string;
    /** Like 1.0.0 */
    version: string;
    apiVersion: 1;
    level: Level;
    author?: string;
    description?: string;
    tokens?: Tokens;
    /** Up to 16. */
    options?: Option[];
    /** Levels 1–2: up to 4 relative .css paths. */
    styles?: string[];
    /** Level 2: relative path to layout.json. */
    layout?: string;
    /** Level 3: relative path to the page (default skin.html). */
    entry?: string;
  }
}

/** The skin SDK (level 3 only). It is set up before your scripts run. */
declare const lx: LxSkin.Api;

interface Window {
  readonly lx: LxSkin.Api;
}
