// Bobby's head over the captions: floats, watches the cursor, blinks, and glances at the app when a step changes.
// One spring drives the look; everything else (the parallax, the lean, the ears) is read off that spring, so the
// parts move as one head. All of it is transforms on the inline SVG's groups.
(() => {
  const el = document.querySelector(".buddy");
  if (!el || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const part = (c) => el.querySelector(c);
  const svg = part("svg"), head = part(".b-head"), face = part(".b-face"), eyes = part(".b-eyes");
  const earL = part(".b-ear-l"), earR = part(".b-ear-r"), shadow = part(".b-shadow");

  /** A critically damped spring toward a moving target: eases in and out, never overshoots, frame-rate free. */
  const spring = (omega) => ({ x: 0, v: 0, omega });
  function step(s, target, dt) {
    const w = s.omega, e = Math.exp(-w * dt), d = s.x - target, t = (s.v + w * d) * dt;
    s.x = target + (d + t) * e; s.v = (s.v - w * t) * e;
  }
  /** A springier one, for the ears: a little overshoot, settles fast. */
  function wobble(s, target, dt, zeta = 0.45) {
    const w = s.omega, n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n;
    for (let i = 0; i < n; i++) { s.v += (w * w * (target - s.x) - 2 * zeta * w * s.v) * h; s.x += s.v * h; }
  }

  const lookX = spring(11), lookY = spring(11);       // where he looks, -1…1
  const glance = spring(7), idle = spring(2.5);        // how much each overrides the cursor, 0…1
  const earSwing = spring(18), earLift = spring(18);    // the ears' answer to how fast the head moves
  let pointer = null, lastMove = -1e9, glanceUntil = 0, hopAt = -1e9, blinkAt = performance.now() + 1800, double = false;

  addEventListener("pointermove", (e) => {
    if (e.pointerType === "touch") return;
    pointer = [e.clientX, e.clientY]; lastMove = performance.now();
  }, { passive: true });
  document.documentElement.addEventListener("pointerleave", () => { lastMove = -1e9; });

  const approved = [...document.querySelectorAll("[data-cap]")].findIndex((c) => /^Approved/.test(c.querySelector("h1, h2")?.textContent ?? ""));
  document.addEventListener("story:step", (e) => {
    glanceUntil = performance.now() + 1100;
    if (e.detail === approved) hopAt = performance.now();
  });

  let prev = performance.now(), float = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;

    // the cursor, measured from where his head sits at rest (not where the float has carried it)
    let cx = 0, cy = 0.15;
    if (pointer) {
      const r = svg.getBoundingClientRect(), x = pointer[0] - (r.left + r.width / 2), y = pointer[1] - (r.top + r.height / 2 - float);
      const d = Math.hypot(x, y) || 1, reach = Math.min(1, d / 280) ** 0.8; // close by he looks less far
      cx = (x / d) * reach; cy = (y / d) * reach;
    }
    // blend in the glance at the app and the idle look-around, rather than switch to them
    step(glance, now < glanceUntil ? 1 : 0, dt);
    step(idle, now - lastMove > 3500 ? 1 : 0, dt);
    const ix = Math.sin(now / 2300) * 0.55 + Math.sin(now / 1370) * 0.15, iy = Math.sin(now / 3100) * 0.22 + 0.12;
    let tx = cx + (ix - cx) * idle.x, ty = cy + (iy - cy) * idle.x;
    tx += (0.95 - tx) * glance.x; ty += (0.05 - ty) * glance.x;
    step(lookX, tx, dt); step(lookY, ty, dt);
    const lx = lookX.x, ly = lookY.x;

    // the ears answer the head's speed: they trail when it turns, lift a little when it drops
    wobble(earSwing, -lookX.v * 0.09, dt); wobble(earLift, -lookY.v * 0.06, dt);
    const swing = Math.max(-1, Math.min(1, earSwing.x)), ear = Math.max(-1, Math.min(1, earLift.x));

    // float, and the hop: a crouch, a jump, a squash on landing
    float = Math.sin(now / 900) * 3;
    const t = (now - hopAt) / 1000;
    let jump = 0, squash = 0;
    if (t >= 0 && t < 1.1) {
      if (t < 0.12) squash = Math.sin(t / 0.12 * Math.PI) * 0.06;                       // crouch
      else if (t < 0.62) { const u = (t - 0.12) / 0.5; jump = -22 * 4 * u * (1 - u); }   // up and down, as thrown
      else squash = Math.sin((t - 0.62) / 0.48 * Math.PI) * 0.05 * (1 - (t - 0.62) / 0.48); // land
    }
    const y = float + jump;
    el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
    svg.style.transform = `scale(${1 + squash}, ${1 - squash})`;
    const height = Math.max(0, -y) / 25;
    shadow.style.transform = `translate3d(0, ${(-y).toFixed(2)}px, 0) scaleX(${(1 - height * 0.35).toFixed(3)})`;
    shadow.style.opacity = (0.95 - height * 0.5).toFixed(3);

    // blink now and then, sometimes twice: shut quickly, open a touch slower
    let lid = 1;
    const b = (now - blinkAt) / 1000;
    if (b >= 0 && b < 0.16) lid = b < 0.06 ? 1 - b / 0.06 * 0.9 : 0.1 + (b - 0.06) / 0.1 * 0.9;
    else if (b >= 0.16) {
      double = !double && Math.random() < 0.2;
      blinkAt = now + (double ? 120 : 2600 + Math.random() * 3600);
    }
    lid = Math.max(0.1, lid);

    // the head turns and leans; the face moves further than the outline, the eyes further still: it reads as 3D.
    // the ears sit behind the face, so they move the other way
    const lean = 9 + lx * 8 + lookX.v * 0.6;
    const f = (n) => n.toFixed(3);
    head.setAttribute("transform", `translate(${f(lx * 2.2)} ${f(ly * 1.8)}) rotate(${f(lean)} 32 34)`);
    face.setAttribute("transform", `translate(${f(lx * 2.6)} ${f(ly * 2.4)})`);
    eyes.setAttribute("transform", `translate(${f(lx * 1.2)} ${f(ly * 1.2 + 31 * (1 - lid))}) scale(1 ${f(lid)})`);
    earL.setAttribute("transform", `translate(${f(-lx * 0.8)} ${f(-ly * 0.4)}) rotate(${f(swing * 14 - ear * 10 - lx * 3)} 26 14)`);
    earR.setAttribute("transform", `translate(${f(-lx * 0.8)} ${f(-ly * 0.4)}) rotate(${f(swing * 14 + ear * 10 - lx * 3)} 37 14)`);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
