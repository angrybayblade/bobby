// Other PRs, for the command palette: switch to a review you've opened (those open in this Bobby first), open one
// from GitHub's lists, or open any PR by its link, owner/repo#123, or #123 in this repo. The pure parts take their
// data as arguments, so tests can call them; openReview talks to the server.

/** A PR to open from what was typed: a link (or a commit's), owner/repo#123, or #123 in `repo` ("owner/name"). */
export function prArg(text, repo) {
  const t = text.trim();
  const link = /^https?:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)/i.exec(t);
  if (link) return { owner: link[1], repo: link[2], number: Number(link[3]), arg: t.replace(/[?#].*$/, "") };
  const m = /^(?:([\w.-]+)\/([\w.-]+))?#(\d+)$/.exec(t);
  if (!m || (!m[1] && !repo)) return null;
  const [owner, name] = m[1] ? [m[1], m[2]] : repo.split("/");
  return { owner, repo: name, number: Number(m[3]), arg: `https://github.com/${owner}/${name}/pull/${m[3]}` };
}

const LISTS = [["review", "review requested"], ["mine", "yours"], ["all", "involves you"]];

/**
 * Palette items for the PRs in `home.recents` and GitHub's `lists`, leaving out the review `here` (its id). Each is
 * { id, group: "pr", title, sub, tag?, pin?, href, open }: `open` is what openReview takes, `pin` lists it before a
 * query (the reviews open in this Bobby), `href` its address in Bobby, for a new tab.
 */
export function prItems(home, lists, here) {
  const items = [], seen = new Set([here]);
  for (const r of home?.recents ?? []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const p = r.progress;
    items.push({
      id: `pr:${r.id}`, group: "pr", pin: !!r.open, href: `/r/${r.id}`,
      title: r.kind === "local" ? `⎇ ${r.branch}` : `#${r.number}${r.commit ? ` @ ${r.commit.sha.slice(0, 7)}` : ""} ${r.title}`,
      sub: [r.kind === "local" ? `local · ${r.repo}${r.baseRef ? ` vs ${r.baseRef}` : ""}` : `${r.owner}/${r.repo}`, r.kind !== "local" && r.author, p?.total && `${p.done}/${p.total} reviewed`].filter(Boolean).join(" · "),
      tag: r.open ? "open" : "",
      open: r.open ? { here: `/r/${r.id}` } : { what: r.kind === "local" ? r.branch : `#${r.number}`, body: r.kind === "local" ? { repo: r.repoDir, base: r.baseRef } : { arg: r.arg, repo: r.repoDir } },
    });
  }
  for (const [k, why] of LISTS) for (const x of lists?.[k] ?? []) {
    const id = `${x.owner}/${x.repo}/${x.number}`;
    if (seen.has(id)) continue;
    seen.add(id);
    items.push({ id: `pr:${id}`, group: "pr", href: `/r/${id}`, title: `#${x.number} ${x.title}`, sub: `${x.owner}/${x.repo} · ${x.author} · ${why}`, tag: x.draft ? "draft" : "", open: { what: `#${x.number}`, body: { arg: x.url } } });
  }
  return items;
}

/** The item for a PR typed into the palette, or none; `here` is this review's id, `repo` its "owner/name". `same` is
 *  the id of its row among prItems, which the palette shows instead when there is one. */
export function typedItem(q, repo, here) {
  const p = prArg(q, repo);
  if (!p) return [];
  const id = `${p.owner}/${p.repo}/${p.number}`;
  if (id === here) return [];
  return [{ id: `open:${id}`, same: `pr:${id}`, group: "pr", href: `/r/${id}`, title: `Open ${p.owner}/${p.repo}#${p.number}`, sub: "review this PR in Bobby", open: { what: `#${p.number}`, body: { arg: p.arg } } }];
}

/**
 * Opens a review in this tab: one already open goes straight there; any other is asked of the server, which may clone
 * it first. Without gh signed in, `setupGh(arg)` sets it up and opens it after.
 */
export async function openReview(o, { toast, setupGh }) {
  if (o.here) return void (location.href = o.here);
  toast(`<span>Opening ${esc(o.what)}…</span>`);
  try {
    const r = await fetch("/api/open", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(o.body) });
    const j = await r.json().catch(() => ({}));
    if (j.id) return void (location.href = `/r/${j.id}`);
    if (j.setup === "gh" && o.body.arg) { toast("", 1); return setupGh(o.body.arg); }
    const how = j.ask === "ssh" ? " Open it from the home page to try SSH." : "";
    toast(`<span>Couldn't open ${esc(o.what)}: ${esc(j.error ?? r.statusText)}${how}</span>`, 10000);
  } catch (e) { toast(`<span>Couldn't open ${esc(o.what)}: ${esc(e.message)}</span>`, 10000); }
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
