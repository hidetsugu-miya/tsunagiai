import { el, tag } from "./dom.js";

// Short notice at the bottom right; it fades after a few seconds.
let toastEl: HTMLElement;
let toastTimer = 0;
// A notice that no timer hides (the Orca start of A-16): it stays until its caller hides it, and shows again when a timed toast that took its place is gone.
let stay: { text: string; spin: boolean } | null = null;
let timed = false;

export function initToast() {
  toastEl = el("toast");
  toastEl.hidden = true;
  toastEl.setAttribute("role", "status");
  document.body.append(toastEl);
}

function drawStay() {
  if (stay === null) {
    toastEl.hidden = true;
    return;
  }
  toastEl.className = "toast stay";
  toastEl.replaceChildren(...(stay.spin ? [tag("span", "spin")] : []), tag("span", "", stay.text));
  toastEl.hidden = false;
}

const endTimed = () => {
  timed = false;
  drawStay();
};

export const hideToast = () => {
  clearTimeout(toastTimer);
  endTimed();
};

// `action` ({ label, run }) adds a button that hides the notice and runs `run`.
export function toast(text: string, action?: { label: string; run: () => void }) {
  toastEl.className = "toast";
  toastEl.textContent = text;
  if (action) {
    const button = document.createElement("button");
    button.textContent = action.label;
    button.onclick = () => {
      hideToast();
      action.run();
    };
    toastEl.append(button);
  }
  toastEl.hidden = false;
  timed = true;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(endTimed, 4000);
}

// A notice with a spinner (or none) that no timer hides: the caller hides it with `hideStay`. Called again with the same text, it changes nothing.
export function showStay(text: string, spin = true) {
  if (stay?.text === text && stay.spin === spin) return;
  stay = { text, spin };
  if (!timed) drawStay();
}

export function hideStay() {
  if (stay === null) return;
  stay = null;
  if (!timed) drawStay();
}
