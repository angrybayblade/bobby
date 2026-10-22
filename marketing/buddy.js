// Bobby's head over the captions: floats, watches the cursor, blinks, and glances at the app when a step changes.
// Everything is a transform on the inline SVG's groups, eased toward a target each frame.
(() => {
  const el = document.querySelector(".buddy");
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const part = (c) => el.querySelector(c);
  const head = part(".b-head"), face = part(".b-face"), eyes = part(".b-eyes"), earL = part(".b-ear-l"), earR = part(".b-ear-r");
  const svg = el.querySelector("svg"), shadow = part(".b-shadow");

  // where he looks, -1…1 on each axis; `look` chases `want`, the ears chase `look` (they lag, so they flop)
  const want = { x: 0, y: 0 }, look = { x: 0, y: 0 }, ear = { x: 0, y: 0, vx: 0, vy: 0 };
  let lastMove = -1e9, glanceUntil = 0, hop = 0, blink = 0, nextBlink = 2000;

  addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    const r = svg.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const dx = e.clientX - cx, dy = e.clientY - cy, d = Math.hypot(dx, dy) || 1;
    const reach = Math.min(1, d / 260); // close by, he looks less far; far off, all the way
    want.x = (dx / d) * reach; want.y = (dy / d) * reach;
    lastMove = performance.now();
  }, { passive: true });
  document.addEventListener("pointerleave", () => { lastMove = -1e9; });

  // a new step: a look at the app (to his right), and a hop when the review is approved
  const approved = [...document.querySelectorAll("[data-cap]")].findIndex((c) => /^Approved/.test(c.querySelector("h1, h2")?.textContent ?? ""));
  document.addEventListener("story:step", (e) => {
    glanceUntil = performance.now() + 900;
    if (e.detail === approved) hop = 1;
  });

  const ease = (a, b, k) => a + (b - a) * k;
  let prev = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - prev); prev = now;
    const k = 1 - Math.pow(0.001, dt / 1000 * 2.2); // frame-rate independent easing

    // idle: no cursor for a while, he looks around on his own
    let tx = want.x, ty = want.y;
    if (now < glanceUntil) { tx = 0.9; ty = 0.1; }
    else if (now - lastMove > 4000) { tx = Math.sin(now / 2300) * 0.6; ty = Math.sin(now / 3100) * 0.25 + 0.1; }
    look.x = ease(look.x, tx, k); look.y = ease(look.y, ty, k);

    // the ears: a spring on the look, underdamped
    const s = dt / 1000;
    ear.vx += ((look.x - ear.x) * 90 - ear.vx * 9) * s; ear.x += ear.vx * s;
    ear.vy += ((look.y - ear.y) * 90 - ear.vy * 9) * s; ear.y += ear.vy * s;
    const flopX = (look.x - ear.x) * 10, flopY = (look.y - ear.y) * 8;

    // float, and the hop on approval
    const bob = Math.sin(now / 700) * 3;
    if (hop > 0) hop = Math.max(0, hop - dt / 900);
    const jump = hop > 0 ? -Math.sin((1 - hop) * Math.PI) * 18 : 0;
    el.style.transform = `translateY(${bob + jump}px)`;
    shadow.style.transform = `scaleX(${1 - (bob + jump) / -60 - 0.05})`;
    shadow.style.opacity = String(1 + (bob + jump) / 40);

    // blink now and then (sometimes twice)
    if (now > nextBlink) { blink = 1; nextBlink = now + 2500 + Math.random() * 3500; if (Math.random() < .2) nextBlink = now + 260; }
    if (blink > 0) blink = Math.max(0, blink - dt / 140);
    const lid = blink > 0 ? Math.max(0.1, Math.abs(blink * 2 - 1)) : 1;

    // the head turns and tilts; the face moves further than the outline, the eyes further still: it reads as 3D
    const lx = look.x, ly = look.y;
    head.setAttribute("transform", `translate(${lx * 2.5} ${ly * 2}) rotate(${9 + lx * 9} 32 34)`);
    face.setAttribute("transform", `translate(${lx * 3} ${ly * 2.6})`);
    eyes.setAttribute("transform", `translate(${lx * 1.4} ${ly * 1.6 + 31 * (1 - lid)}) scale(1 ${lid})`);
    earL.setAttribute("transform", `translate(${lx * -0.6} 0) rotate(${flopX * 3 + flopY * 2 - lx * 4} 26 14)`);
    earR.setAttribute("transform", `translate(${lx * -0.6} 0) rotate(${flopX * 3 - flopY * 2 - lx * 4} 37 14)`);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
