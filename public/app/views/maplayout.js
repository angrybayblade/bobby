// Layout for the Map's diagram: a layered drawing, top to bottom (Sugiyama's method). Each box sits a row below the
// furthest box that leads into it. Between two rows of boxes there's a row for what crosses it: an edge's label, in
// the row just after where it leaves, and a waypoint in every other row it passes, so a long edge goes round the boxes
// in its way and no label can land on a box or another label. Rows are ordered to cross as few lines as they can,
// then each item moves as close to what it's linked to as the items beside it allow, so lines run straight.
//
//   nodes: [{ id, w, h }], in preferred order (it breaks ties and cycles)
//   edges: [{ from, to, label: { w, h } | null }]
// Returns { nodes: Map id → { x, y, w, h } (top left), edges: [{ points: [[x, y]…] from → to, label: { x, y } | null }]
// (in edges' order, null for a loop), width, height }.
const GAP = { node: 36, label: 14, way: 10 }; // the least room beside an item of each sort
const ROW = 22, PAD = 10; // a row of waypoints only; the room above and below a row of labels

export function mapLayout(nodes, edges) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const out = new Map(nodes.map((n) => [n.id, []]));
  edges.forEach((e, i) => { if (e.from !== e.to && idx.has(e.from) && idx.has(e.to)) out.get(e.from).push(i); });

  // Cycles: walk depth-first in preferred order; an edge back up the path is laid out the other way round.
  const flip = new Set(), state = new Map();
  const visit = (a) => {
    state.set(a, 1);
    for (const i of out.get(a)) {
      const b = edges[i].to;
      if (state.get(b) === 1) { flip.add(i); continue; }
      if (!state.has(b)) visit(b);
    }
    state.set(a, 2);
  };
  for (const n of nodes) if (!state.has(n.id)) visit(n.id);
  const live = edges.map((e, i) => i).filter((i) => edges[i].from !== edges[i].to && idx.has(edges[i].from) && idx.has(edges[i].to));
  const ends = (i) => (flip.has(i) ? [edges[i].to, edges[i].from] : [edges[i].from, edges[i].to]);

  // Rows: the longest path from a source; then a source with nothing else above it moves down to just above what it
  // feeds, so a caller sits by what it calls.
  const rank = new Map(nodes.map((n) => [n.id, 0])), preds = new Map(nodes.map((n) => [n.id, []])), succs = new Map(nodes.map((n) => [n.id, []]));
  for (const i of live) { const [a, b] = ends(i); succs.get(a).push(b); preds.get(b).push(a); }
  const indeg = new Map(nodes.map((n) => [n.id, preds.get(n.id).length])), queue = nodes.map((n) => n.id).filter((id) => !indeg.get(id));
  while (queue.length) {
    const a = queue.shift();
    for (const b of succs.get(a)) { rank.set(b, Math.max(rank.get(b), rank.get(a) + 1)); indeg.set(b, indeg.get(b) - 1); if (!indeg.get(b)) queue.push(b); }
  }
  for (const n of nodes) if (!preds.get(n.id).length && succs.get(n.id).length) rank.set(n.id, Math.min(...succs.get(n.id).map((b) => rank.get(b))) - 1);

  // Items: a box at row 2r; an edge's label and waypoints in the rows between its ends.
  const items = [], layers = [], put = (it) => { it.k = items.length; items.push(it); (layers[it.row] ??= []).push(it); return it; };
  const box = new Map(nodes.map((n) => [n.id, put({ kind: "node", id: n.id, w: n.w, h: n.h, row: rank.get(n.id) * 2 })]));
  const chains = new Map(); // edge → its items, from end to end as laid out
  for (const i of live) {
    const [a, b] = ends(i), chain = [box.get(a)], top = box.get(b).row;
    for (let row = box.get(a).row + 1; row < top; row++) {
      const label = row === box.get(a).row + 1 && edges[i].label; // in the row after its tail: for a flipped edge, after its head
      chain.push(put(label ? { kind: "label", w: label.w, h: label.h, row } : { kind: "way", w: 0, h: 0, row }));
    }
    chain.push(box.get(b));
    chains.set(i, chain);
  }
  for (let r = 0; r < layers.length; r++) layers[r] ??= [];
  const up = new Map(items.map((it) => [it, []])), down = new Map(items.map((it) => [it, []]));
  for (const chain of chains.values()) for (let j = 1; j < chain.length; j++) { down.get(chain[j - 1]).push(chain[j]); up.get(chain[j]).push(chain[j - 1]); }

  // Order inside each row: barycentre sweeps, keeping the order with the fewest crossings.
  const pos = new Map();
  const index = () => layers.forEach((l) => l.forEach((it, j) => pos.set(it, j)));
  const crossings = () => {
    let c = 0;
    for (let r = 0; r + 1 < layers.length; r++) {
      const segs = layers[r].flatMap((a) => down.get(a).map((b) => [pos.get(a), pos.get(b)]));
      for (let p = 0; p < segs.length; p++) for (let q = p + 1; q < segs.length; q++) if ((segs[p][0] - segs[q][0]) * (segs[p][1] - segs[q][1]) < 0) c++;
    }
    return c;
  };
  index();
  let best = layers.map((l) => [...l]), fewest = crossings();
  for (let sweep = 0; sweep < 12 && fewest; sweep++) {
    const goDown = sweep % 2 === 0, rows = [...layers.keys()];
    for (const r of goDown ? rows.slice(1) : rows.reverse().slice(1)) {
      const by = (it) => { const ns = (goDown ? up : down).get(it); return ns.length ? ns.reduce((s, n) => s + pos.get(n), 0) / ns.length : pos.get(it); };
      const b = new Map(layers[r].map((it) => [it, by(it)]));
      layers[r].sort((p, q) => b.get(p) - b.get(q) || pos.get(p) - pos.get(q));
      layers[r].forEach((it, j) => pos.set(it, j));
    }
    const c = crossings();
    if (c < fewest) { fewest = c; best = layers.map((l) => [...l]); }
  }
  best.forEach((l, r) => { layers[r] = l; });
  index();

  // Across: packed, then each item pulled toward the middle of what it links to, the rows above then the rows below,
  // as near as its neighbours in the row allow. A waypoint pulls hardest, so a long edge runs straight.
  const x = new Map(); // an item's centre
  const room = (p, q) => (p.w + q.w) / 2 + Math.max(GAP[p.kind], GAP[q.kind]);
  for (const l of layers) l.forEach((it, j) => x.set(it, j ? x.get(l[j - 1]) + room(l[j - 1], it) : it.w / 2));
  const weight = (p, q) => (p.kind === "way" && q.kind === "way" ? 8 : p.kind === "node" && q.kind === "node" ? 1 : 2);
  for (let pass = 0; pass < 10; pass++) {
    const rows = [...layers.keys()], goDown = pass % 2 === 0;
    for (const r of goDown ? rows : rows.reverse()) {
      const l = layers[r];
      const want = l.map((it) => {
        const ns = pass < 2 ? (goDown ? up : down).get(it) : [...up.get(it), ...down.get(it)];
        if (!ns.length) return x.get(it);
        let s = 0, w = 0;
        for (const n of ns) { const k = weight(it, n); s += k * x.get(n); w += k; }
        return s / w;
      });
      settle(l, want, room).forEach((v, j) => x.set(l[j], v));
    }
  }
  const left = Math.min(...items.map((it) => x.get(it) - it.w / 2));
  for (const it of items) x.set(it, x.get(it) - left);

  // Down: each row as tall as its tallest item; a row with labels gets room around them.
  const y = new Map(); // an item's centre
  let top = 0;
  for (const l of layers) {
    const hasBox = l.some((it) => it.kind === "node"), hasLabel = l.some((it) => it.kind === "label");
    const tall = Math.max(0, ...l.map((it) => it.h)) + (hasBox ? 0 : hasLabel ? 2 * PAD : 0);
    const h = hasBox ? tall : Math.max(ROW, tall) + 18;
    for (const it of l) y.set(it, top + h / 2);
    top += h;
  }

  // Edges: from the bottom of the box above to the top of the one below, through its items. Edges leaving one side
  // of a box spread along it, in the order of where they go, so each meets the box at a point of its own.
  const ports = new Map(); // `${edge} ${item.k} ${side}` → x
  const spread = (it, side) => {
    const mine = [...chains].filter(([, c]) => (side === "bottom" ? c[0] : c.at(-1)) === it);
    mine.sort(([, p], [, q]) => x.get(side === "bottom" ? p[1] : p.at(-2)) - x.get(side === "bottom" ? q[1] : q.at(-2)));
    const step = mine.length > 1 ? Math.min(18, (it.w - 40) / (mine.length - 1)) : 0;
    mine.forEach(([i], j) => ports.set(`${i} ${side}`, x.get(it) + (j - (mine.length - 1) / 2) * step));
  };
  for (const it of box.values()) { spread(it, "bottom"); spread(it, "top"); }
  const placed = new Map();
  for (const [i, chain] of chains) {
    const a = chain[0], b = chain.at(-1);
    const points = [[ports.get(`${i} bottom`), y.get(a) + a.h / 2], ...chain.slice(1, -1).map((it) => [x.get(it), y.get(it)]), [ports.get(`${i} top`), y.get(b) - b.h / 2]];
    const label = chain.find((it) => it.kind === "label");
    placed.set(i, { points: flip.has(i) ? points.reverse() : points, label: label ? { x: x.get(label), y: y.get(label) } : null });
  }
  return {
    nodes: new Map([...box].map(([id, it]) => [id, { x: x.get(it) - it.w / 2, y: y.get(it) - it.h / 2, w: it.w, h: it.h }])),
    edges: edges.map((e, i) => placed.get(i) ?? null),
    width: Math.max(0, ...items.map((it) => x.get(it) + it.w / 2)),
    height: top,
  };
}

/** The positions nearest to want (least squares) that keep the row's order and room between neighbours: subtract each
 *  item's least offset from the first, fit a non-decreasing sequence (pool adjacent violators), add the offsets back. */
export function settle(row, want, room) {
  const off = [0];
  for (let j = 1; j < row.length; j++) off.push(off[j - 1] + room(row[j - 1], row[j]));
  const blocks = []; // [sum, count]
  want.forEach((w, j) => {
    blocks.push([w - off[j], 1]);
    while (blocks.length > 1 && blocks.at(-2)[0] / blocks.at(-2)[1] > blocks.at(-1)[0] / blocks.at(-1)[1]) {
      const [s, c] = blocks.pop();
      blocks.at(-1)[0] += s; blocks.at(-1)[1] += c;
    }
  });
  const fit = blocks.flatMap(([s, c]) => Array(c).fill(s / c));
  return fit.map((v, j) => v + off[j]);
}
