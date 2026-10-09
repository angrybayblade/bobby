// Layered layout for a directed graph of boxes: each box sits one rank right of the furthest box that
// leads into it, so a → b → c reads left to right even when a, b and c belong to the same group.
// Connected components are laid out on their own and stacked; boxes linked to nothing share a grid at the end.
//
//   ids:   node keys, in preferred order (it breaks ties and cycles)
//   edges: [from, to] pairs
//   h:     id → box height
//   gap:   vertical gap between boxes in a rank
//   wrap:  columns for the grid of unlinked boxes
// Returns { rank: Map id → column, y: Map id → top, comps: [{ ids, top, bottom, linked }] }.
export function layered(ids, edges, { h, gap, compGap, wrap = 3 }) {
  const idx = new Map(ids.map((id, i) => [id, i]));
  const out = new Map(ids.map((id) => [id, new Set()])), inn = new Map(ids.map((id) => [id, new Set()]));
  for (const [a, b] of edges) if (a !== b && idx.has(a) && idx.has(b)) { out.get(a).add(b); inn.get(b).add(a); }

  // Cycles: walk depth-first in preferred order and drop edges that point back up the current path.
  const dag = new Map(ids.map((id) => [id, []])), state = new Map();
  const visit = (a) => {
    state.set(a, 1);
    for (const b of [...out.get(a)].sort((x, y) => idx.get(x) - idx.get(y))) {
      if (state.get(b) === 1) continue; // back edge
      dag.get(a).push(b);
      if (!state.has(b)) visit(b);
    }
    state.set(a, 2);
  };
  for (const id of ids) if (!state.has(id)) visit(id);
  const preds = new Map(ids.map((id) => [id, []]));
  for (const [a, bs] of dag) for (const b of bs) preds.get(b).push(a);

  // Components, ignoring direction.
  const comp = new Map();
  for (const id of ids) {
    if (comp.has(id)) continue;
    const list = [], stack = [id];
    comp.set(id, list);
    while (stack.length) {
      const a = stack.pop();
      list.push(a);
      for (const b of [...out.get(a), ...inn.get(a)]) if (!comp.has(b)) { comp.set(b, list); stack.push(b); }
    }
  }
  const comps = [...new Set(comp.values())].map((list) => list.sort((a, b) => idx.get(a) - idx.get(b)));

  const rank = new Map(), y = new Map(), result = [];
  let top = 0;
  for (const list of comps.filter((l) => l.length > 1)) {
    // Longest path from the sources, in topological order.
    const indeg = new Map(list.map((id) => [id, preds.get(id).length]));
    const queue = list.filter((id) => !indeg.get(id));
    for (const id of queue) rank.set(id, 0);
    while (queue.length) {
      const a = queue.shift();
      for (const b of dag.get(a)) {
        rank.set(b, Math.max(rank.get(b) ?? 0, rank.get(a) + 1));
        indeg.set(b, indeg.get(b) - 1);
        if (!indeg.get(b)) queue.push(b);
      }
    }
    const succs = (id) => dag.get(id);
    const ranks = [];
    for (const id of list) (ranks[rank.get(id)] ??= []).push(id);

    // Order inside each rank: a few barycentre sweeps, so lines cross as little as possible.
    const pos = new Map();
    const index = () => { for (const r of ranks) r.forEach((id, i) => pos.set(id, i)); };
    index();
    const bary = (id, ns) => (ns.length ? ns.reduce((s, n) => s + pos.get(n), 0) / ns.length : pos.get(id));
    for (let sweep = 0; sweep < 4; sweep++) {
      const down = sweep % 2 === 0;
      const order = down ? ranks.keys() : [...ranks.keys()].reverse();
      for (const r of order) {
        ranks[r].sort((a, b) => bary(a, down ? preds.get(a) : succs(a)) - bary(b, down ? preds.get(b) : succs(b)));
        ranks[r].forEach((id, i) => pos.set(id, i));
      }
    }

    // Heights: line each box up with what leads into it, then pull the sources toward what they feed.
    const centre = (id) => y.get(id) + h(id) / 2;
    const stackRank = (r, want) => {
      let floor = 0;
      for (const id of r) { const t = Math.max(floor, want(id)); y.set(id, t); floor = t + h(id) + gap; }
    };
    const mean = (ns) => ns.reduce((s, n) => s + centre(n), 0) / ns.length;
    ranks.forEach((r, i) => stackRank(r, (id) => (i && preds.get(id).length ? mean(preds.get(id)) - h(id) / 2 : 0)));
    for (let i = ranks.length - 2; i >= 0; i--) stackRank(ranks[i], (id) => (preds.get(id).length || !succs(id).length ? y.get(id) : Math.max(0, mean(succs(id)) - h(id) / 2)));

    const lo = Math.min(...list.map((id) => y.get(id)));
    for (const id of list) y.set(id, y.get(id) - lo + top);
    const bottom = Math.max(...list.map((id) => y.get(id) + h(id)));
    result.push({ ids: list, top, bottom, linked: true });
    top = bottom + compGap;
  }

  // Boxes linked to nothing: one grid, in preferred order.
  const lone = comps.filter((l) => l.length === 1).map((l) => l[0]).sort((a, b) => idx.get(a) - idx.get(b));
  if (lone.length) {
    const start = top;
    for (let i = 0; i < lone.length; i += wrap) {
      const row = lone.slice(i, i + wrap);
      row.forEach((id, c) => { rank.set(id, c); y.set(id, top); });
      top += Math.max(...row.map(h)) + gap;
    }
    result.push({ ids: lone, top: start, bottom: top - gap, linked: false });
  }
  return { rank, y, comps: result };
}
