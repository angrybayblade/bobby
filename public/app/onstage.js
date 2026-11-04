// How far a canvas's camera has to move for a box to be on its stage: as little as it can, and if the box doesn't fit,
// its start stays in view. Both rects on screen; the camera moves by minus the result.
const along = (lo, hi, min, max, pad) => {
  if (lo < min + pad) return lo - min - pad;
  if (hi > max - pad) return Math.min(hi - max + pad, lo - min - pad);
  return 0;
};
export const nudge = (box, stage, pad = 12) => ({
  dx: along(box.left, box.right, stage.left, stage.right, pad),
  dy: along(box.top, box.bottom, stage.top, stage.bottom, pad),
});

// How fast, in on-screen px a second, holding a pointer at y scrolls what's between lo and hi: nothing away from its ends,
// then faster the further toward and past them. Minus is up.
export const edgeSpeed = (y, lo, hi, zone = 40, slow = 120, max = 1600) => {
  const past = y < lo + zone ? y - lo - zone : y > hi - zone ? y - hi + zone : 0;
  return past && Math.sign(past) * Math.min(max, slow + (Math.abs(past) / zone) * 400);
};
