// What keeps your place when the code around you redraws. No imports, so it can be tested without a page.

/** Before a render: if you're typing in el (a comment, a reply, an edit), what puts you back in its box afterwards,
 *  caret, its own scroll and all; else null. A poll or a mark can redraw the code under you at any keystroke. */
export function replying(el) {
  const a = document.activeElement;
  const attr = ["data-composer", "data-rbox", "data-gedit"].find((x) => a?.matches?.(`textarea[${x}]`));
  if (!attr || !el.contains(a)) return null;
  const sel = `textarea[${attr}="${CSS.escape(a.getAttribute(attr))}"]`, at = [a.selectionStart, a.selectionEnd], top = a.scrollTop;
  return () => { const b = el.querySelector(sel); if (b) { b.focus({ preventScroll: true }); b.setSelectionRange(...at); b.scrollTop = top; } };
}

/** One column's viewers with their heights changed: each stays where it was laid out (y0) unless the one above would
 *  cover it, and then moves only as far as it must. So a file that grows moves what's right below it, nothing else,
 *  and what moved goes back when it shrinks. Returns [viewer, y] from the top. */
export function stacked(col, gap) {
  let floor = -Infinity;
  return [...col].sort((a, b) => a.y0 - b.y0).map((v) => {
    const y = Math.max(v.y0, floor);
    floor = y + v.h + gap;
    return [v, y];
  });
}
