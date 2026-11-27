// Which screens of the side menu are on (A-5, A-50), and the work that runs for a screen only while it is on (#680).
// `ts/nav.ts` hands the saved list to `applyMenu` when it is read and each time the menu tab saves one. A part registered with `whileOn` starts when its screen is on (once the list has been read, so an off screen never starts) and stops when the screen goes off.
// The inbox cannot be turned off, so no part of it is registered here.
import type { MenuEntry } from "./bindings/MenuEntry";
import type { MenuScreen } from "./bindings/MenuScreen";

const SCREENS: MenuScreen[] = ["mail", "calendar", "todo", "slack", "orca", "database"];

// The screens that are on. Every screen until the saved list has been read.
let on = new Set<MenuScreen>(SCREENS);
let read = false;

interface Part {
  screen: MenuScreen;
  start: () => void;
  stop: () => void;
  // null until the saved list is read, so the first read starts or stops each part, whichever the screen is.
  running: boolean | null;
}
const parts: Part[] = [];

export const screenOn = (screen: MenuScreen) => on.has(screen);

function settle(part: Part) {
  if (!read) return;
  const want = on.has(part.screen);
  if (want === part.running) return;
  part.running = want;
  if (want) part.start();
  else part.stop();
}

// Registers work for `screen`: `start` runs when the screen is on (after the saved list is read, and each time it is turned on again), `stop` when it is turned off.
export function whileOn(screen: MenuScreen, start: () => void, stop: () => void) {
  const part: Part = { screen, start, stop, running: null };
  parts.push(part);
  settle(part);
}

// Runs `run` every `ms` while `screen` is on, and not at all while it is off.
export function everyWhileOn(screen: MenuScreen, run: () => void, ms: number) {
  let timer: number | null = null;
  whileOn(
    screen,
    () => {
      timer = window.setInterval(run, ms);
    },
    () => {
      if (timer !== null) window.clearInterval(timer);
      timer = null;
    },
  );
}

// Takes the list as it is now (Rust's answer, or every screen on when it could not be read) and starts and stops the parts that it changes.
export function applyMenu(items: MenuEntry[]) {
  on = new Set(items.filter((entry) => entry.enabled).map((entry) => entry.screen));
  on.add("mail");
  read = true;
  for (const part of parts) settle(part);
}

// The list when the saved one cannot be read: every screen on, as the first values are.
export const everyScreenOn = (): MenuEntry[] => SCREENS.map((screen) => ({ screen, enabled: true }));
