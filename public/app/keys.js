// Every action a key can run, by a stable id, with its default keys. Your own bindings live in settings.keys
// ({ id: [keys] }, replacing that action's defaults); everything that shows a key asks here, so hints, the key sheet,
// the palette and the tour follow them. Keys are KeyboardEvent.key values ("j", "J", "Enter", " ", "ArrowLeft", "!").

export const ACTIONS = [
  // moving
  { id: "next", group: "Moving", title: "Next page", keys: ["j", " "] },
  { id: "prev", group: "Moving", title: "Previous page", keys: ["k"] },
  { id: "left", group: "Moving", title: "Back: in Diff, the node you were on before; elsewhere, back along an edge (Outline: parent)", keys: ["ArrowLeft"] },
  { id: "right", group: "Moving", title: "Forth: in Diff, the node you came back from; elsewhere, on along an edge (Outline: first nested page)", keys: ["ArrowRight"] },
  { id: "up", group: "Moving", title: "Previous page at the same level (Outline: row; Diff: the node above)", keys: ["ArrowUp"] },
  { id: "down", group: "Moving", title: "Next page at the same level (Outline: row; Diff: the node below)", keys: ["ArrowDown"] },
  { id: "treeLeft", group: "Moving", title: "Along the layout, back: in Diff, the node this one comes from (elsewhere, as ←)", keys: ["Shift+ArrowLeft"] },
  { id: "treeRight", group: "Moving", title: "Along the layout, on: in Diff, the node this one leads into (elsewhere, as →)", keys: ["Shift+ArrowRight"] },
  { id: "treeUp", group: "Moving", title: "Along the layout, up (elsewhere, as ↑)", keys: ["Shift+ArrowUp"] },
  { id: "treeDown", group: "Moving", title: "Along the layout, down (elsewhere, as ↓)", keys: ["Shift+ArrowDown"] },
  { id: "nextCore", group: "Moving", title: "Next core", keys: ["J"] },
  { id: "prevCore", group: "Moving", title: "Previous core", keys: ["K"] },
  { id: "entry", group: "Moving", title: "Back to the entry point, where a load starts", keys: ["!"] },
  { id: "nextUnreviewed", group: "Moving", title: "Next unreviewed page", keys: ["n"] },
  { id: "nextFlagged", group: "Moving", title: "Next flagged page", keys: ["F"] },
  { id: "nextUnresolved", group: "Moving", title: "Next unresolved GitHub thread", keys: ["N"] },
  { id: "zoomIn", group: "Moving", title: "Zoom in: overview → core → page", keys: ["Enter", "+", "="] },
  { id: "zoomOut", group: "Moving", title: "Zoom out (esc also closes what's open first)", keys: ["Escape", "-", "_"] },
  // reading
  { id: "focus", group: "Reading", title: "Focus mode: what you're on fills the screen; again to go back", keys: ["f"] },
  { id: "fit", group: "Reading", title: "Fit: the file you're on, as wide as it goes with its top at the top (as a double-click in the file tree); again to go back", keys: ["d"] },
  { id: "fullScreen", group: "Reading", title: "Details: the page on its own, with what it relies on and affects; again to go back", keys: ["g"] },
  { id: "expand", group: "Reading", title: "Open collapsed code, then more context", keys: ["e"] },
  { id: "nextView", group: "Reading", title: "Next view, to the right: Conversation, Map, Lens, Outline, Flow, Diff", keys: ["v", "Ctrl+."] },
  { id: "prevView", group: "Reading", title: "Previous view, to the left", keys: ["Ctrl+,"] },
  { id: "view:conversation", group: "Reading", title: "Switch to Conversation", keys: ["Ctrl+1"] },
  { id: "view:map", group: "Reading", title: "Switch to Map", keys: ["Ctrl+2"] },
  { id: "view:lens", group: "Reading", title: "Switch to Lens", keys: ["Ctrl+3"] },
  { id: "view:outline", group: "Reading", title: "Switch to Outline", keys: ["Ctrl+4"] },
  { id: "view:flow", group: "Reading", title: "Switch to Flow", keys: ["Ctrl+5"] },
  { id: "view:diff", group: "Reading", title: "Switch to Diff", keys: ["Ctrl+6"] },
  { id: "layout", group: "Reading", title: "Diff layout: inline or split", keys: ["l"] },
  { id: "files", group: "Reading", title: "Show or hide the file tree", keys: ["t"] },
  { id: "tests", group: "Reading", title: "Show or hide test files, in every view", keys: ["T"] },
  { id: "generated", group: "Reading", title: "Show or hide generated files, in every view", keys: ["G"] },
  { id: "untouched", group: "Reading", title: "Show or hide unchanged code the changes rely on or affect, in every view", keys: ["U"] },
  { id: "comments", group: "Reading", title: "Show or collapse every comment in the PR", keys: ["C"] },
  // reviewing
  { id: "reviewed", group: "Reviewing", title: "Looks good: mark reviewed and move on", keys: ["a"] },
  { id: "unmark", group: "Reviewing", title: "Un-mark this page", keys: ["u"] },
  { id: "flag", group: "Reviewing", title: "Flag or unflag, to come back to", keys: ["x"] },
  { id: "lineDown", group: "Reviewing", title: "Select the next line, to comment on", keys: ["]"] },
  { id: "lineUp", group: "Reviewing", title: "Select the previous line", keys: ["["] },
  { id: "lineDownMore", group: "Reviewing", title: "Grow the selection down", keys: ["}"] },
  { id: "lineUpMore", group: "Reviewing", title: "Grow the selection up", keys: ["{"] },
  { id: "comment", group: "Reviewing", title: "Comment on a line (the selected ones, else the likeliest)", keys: ["c"] },
  { id: "note", group: "Reviewing", title: "Private note on a line: only you see it", keys: ["m"] },
  { id: "ask", group: "Reviewing", title: "Ask Claude about the selected lines (else the likeliest)", keys: ["q"] },
  { id: "claudeReview", group: "Reviewing", title: "Review with Claude: what it's doing, or its findings once it's done", keys: ["Q"] },
  { id: "notes", group: "Reviewing", title: "Your notes", keys: ["M"] },
  { id: "park", group: "Reviewing", title: "Park a thought, shown when you return", keys: ["p"] },
  { id: "submit", group: "Reviewing", title: "Submit review", keys: ["s"] },
  // the app
  { id: "switchTree", group: "Bobby", title: "Switch to Claude's tree, when it's ready", keys: ["R"] },
  { id: "settings", group: "Bobby", title: "Settings", keys: [","] },
  { id: "help", group: "Bobby", title: "All keys", keys: ["?"] },
];
export const action = (id) => ACTIONS.find((a) => a.id === id);

/** An action's keys: yours if you've set them, else its defaults. */
export const keysOf = (settings, id) => settings.keys?.[id] ?? action(id)?.keys ?? [];
/** The action a key runs, or undefined. Binding a key takes it from any other action (bind), so a key has one. */
export const actionFor = (settings, key) => ACTIONS.find((a) => keysOf(settings, a.id).includes(key))?.id;

const NAMES = { Enter: "enter", Escape: "esc", " ": "space", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓", "!": "shift 1", Tab: "tab", Backspace: "⌫", Delete: "del" };
/** How a key is shown: its words, each in its own <kbd> ("shift 1" is two, "shift ←" too). */
export const keyText = (k) => (k.startsWith("Shift+") ? `shift ${keyText(k.slice(6))}` : k.startsWith("Ctrl+") ? `ctrl ${keyText(k.slice(5))}` : NAMES[k] ?? k);
export const kbdHtml = (k) => keyText(k).split(" ").map((x) => `<kbd>${esc(x)}</kbd>`).join(" ");
/** An action's first key as plain text, for a tooltip: "c", "shift 1", or "unbound". */
export const keyName = (settings, id) => (keysOf(settings, id)[0] ? keyText(keysOf(settings, id)[0]) : "unbound");
/** An action's keys for a hint or a sentence: the first (or first n), as <kbd>s; "unbound" if it has none. */
export function keyHtml(settings, id, n = 1) {
  const ks = keysOf(settings, id).slice(0, n);
  return ks.length ? ks.map(kbdHtml).join(" ") : `<span class="unbound">unbound</span>`;
}

/** Binds a key to an action, taking it from any action that had it (default or yours). Returns the action it was taken
 *  from, if any, and the new settings.keys. */
export function bind(settings, id, key) {
  const keys = { ...(settings.keys ?? {}) };
  const from = ACTIONS.find((a) => a.id !== id && keysOf(settings, a.id).includes(key));
  if (from) keys[from.id] = keysOf(settings, from.id).filter((k) => k !== key);
  keys[id] = [...keysOf(settings, id).filter((k) => k !== key), key];
  return { from: from?.id, keys: tidy(keys) };
}
export function unbind(settings, id, key) {
  return tidy({ ...(settings.keys ?? {}), [id]: keysOf(settings, id).filter((k) => k !== key) });
}
export function reset(settings, id) {
  const keys = { ...(settings.keys ?? {}) };
  if (id) delete keys[id];
  else return {};
  // a default it takes back from another action: that action loses it
  for (const k of action(id).keys) for (const other of Object.keys(keys)) if (keys[other].includes(k)) keys[other] = keys[other].filter((x) => x !== k);
  return tidy(keys);
}
/** Only what differs from the defaults is kept. */
function tidy(keys) {
  const out = {};
  for (const [id, ks] of Object.entries(keys)) {
    const d = action(id)?.keys ?? [];
    if (ks.length !== d.length || ks.some((k, i) => k !== d[i])) out[id] = ks;
  }
  return out;
}
/** Keys that can't be bound: modifiers alone, what text fields and the browser need, and ctrl+K (the palette). Ctrl
 *  with a key is bindable, without shift. */
export const bindable = (ev) => !["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab", "Dead", "Unidentified"].includes(ev.key) && !ev.metaKey && !ev.altKey
  && !(ev.ctrlKey && (ev.shiftKey || ev.key.toLowerCase() === "k"));
/** A keydown as a key: shift+1 is "!" whatever the layout prints; shift with a named key (an arrow, enter) is
 *  "Shift+<key>". A printed character carries its shift already ("J", "?"). */
export function keyOfEvent(ev) {
  if (ev.ctrlKey) return `Ctrl+${ev.key.length === 1 ? ev.key.toLowerCase() : ev.key}`; // ctrl+1, ctrl+. (ctrl+shift isn't bound)
  if (ev.shiftKey && ev.code === "Digit1") return "!";
  return ev.shiftKey && ev.key.length > 1 && ev.key !== "Shift" ? `Shift+${ev.key}` : ev.key;
}

// core.js's, which this can't import: the tests load this outside a page
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
