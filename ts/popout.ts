// The page of the window of a tab (A-46; `popout.html`, made by `orca_popout_open` of `orca_popout.rs`): a header with the tab's icon and name, the pin and the button that puts the tab back in its pane, and the tab under it.
// It is a page of its own, since `index.html` would start every screen again and answer the questions of the screen bridge twice. It loads only what draws a terminal (`orca-terminal.ts`), and the window has no permission of its own: what it does goes through the commands `orca_popout_*`.
// What the tab shows comes from Rust (`orca_popout_attach`) and again each time the Orca screen knows more of the tab (the channel it gives); the red button of the window is not here: Rust stops it and asks the Orca screen to close the tab.
// A kind of tab that this page can show has a function in `shows`; the terminal of a Claude session and of a plain terminal is shown as the Orca screen shows it (the owner of its terminals is this window), with the font and the colors the settings give the terminals.
import type { PopoutTab } from "./bindings/PopoutTab";
import { $, tag } from "./dom.js";
import { CLOSE_SVG, fillIcons } from "./icons.js";
import { invoke } from "./ipc.js";
import { applyTerminalFont, applyTerminalSettings, applyTerminalTheme, hideTerminals, initOrcaTerminal, showTerminals } from "./orca-terminal.js";
import { statusIcon } from "./orca-status.js";

const OWNER = "orca-popout";

// A failure is written to the log and shown as a card (A-28), as `error-card.ts` does for the screens (which is not loaded here).
function fail(e: unknown) {
  const text = String(e);
  invoke("log_write", { level: "error", source: "orca-popout", message: text }).catch(() => {});
  if ([...document.querySelectorAll(".error-card-text")].some((n) => n.textContent === text)) return;
  const card = tag("div", "error-card");
  card.setAttribute("role", "alert");
  const close = tag("button", "icon-btn error-card-close");
  close.type = "button";
  close.setAttribute("aria-label", "閉じる");
  close.innerHTML = CLOSE_SVG;
  close.onclick = () => card.remove();
  const body = tag("div", "error-card-body");
  body.append(tag("div", "error-card-text", text));
  card.append(body, close);
  $("error-cards").prepend(card);
}

// The kinds of tab this page shows.
const shows: { [K in PopoutTab["content"]["kind"]]: (tab: PopoutTab & { content: { kind: K } }) => void } = {
  claude: (tab) => showTerminal(tab),
  terminal: (tab) => showTerminal(tab),
};

function showTerminal(tab: PopoutTab & { content: { kind: "claude" | "terminal" } }) {
  const { handle, path, stream, ended } = tab.content;
  const source = { kind: stream ? ("stream" as const) : ("mirror" as const), handle, path, environment: tab.environment, ended };
  showTerminals([{ id: handle, source, host: $("popout-term") }], handle, OWNER);
}

// Draws the header, and the tab under it.
function draw(tab: PopoutTab) {
  $("popout-icon").replaceChildren(statusIcon(tab.status, tab.label));
  $("popout-name").textContent = tab.title;
  document.title = tab.title;
  (shows[tab.content.kind] as (tab: PopoutTab) => void)(tab);
}

// The font, the colors and Ghostty's settings that the Orca screen gives its terminals (A-13, A-14, A-20), read again each time the page is made.
async function drawLook() {
  const [saved, themes, fonts] = await Promise.all([invoke("ghostty_saved"), invoke("terminal_themes"), invoke("font_settings")]);
  applyTerminalSettings(saved?.settings ?? null);
  const colorsOf = (name: string) => themes.themes.find((t) => t.name === name)?.colors;
  const [light, dark] = [colorsOf(themes.selection.light), colorsOf(themes.selection.dark)];
  applyTerminalTheme(light && dark ? { light, dark, appearance: themes.selection.appearance } : null);
  const pick = fonts.orcaWork;
  applyTerminalFont(pick.ghostty ? null : { family: pick.family, size: pick.size });
}

async function init() {
  fillIcons();
  initOrcaTerminal(fail, () => {});
  const pin = $<HTMLButtonElement>("popout-pin");
  pin.onclick = () => {
    const pinned = pin.getAttribute("aria-pressed") !== "true";
    pin.setAttribute("aria-pressed", String(pinned));
    invoke("orca_popout_pin", { pinned }).catch((e) => {
      pin.setAttribute("aria-pressed", String(!pinned));
      fail(e);
    });
  };
  $("popout-restore").onclick = () => {
    // The terminal stops here first, so the keys not sent yet go before the screen shows it again.
    hideTerminals(OWNER);
    invoke("orca_popout_restore").catch(fail);
  };
  const channel = new window.__TAURI__.core.Channel<PopoutTab>();
  channel.onmessage = draw;
  try {
    await drawLook();
  } catch (e) {
    fail(e);
  }
  try {
    draw(await invoke("orca_popout_attach", { channel }));
  } catch (e) {
    fail(e);
  }
}

void init();
