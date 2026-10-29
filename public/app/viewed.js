// Bobby's viewed files and GitHub's Viewed checkboxes, in step. On load, a file ticked on GitHub is marked viewed here
// (every page of it); after that, a file that becomes viewed here (its last page marked, or Mark viewed), or stops
// being, ticks or clears its box on GitHub. GitHub's "viewed, but changed since" counts as not viewed. A whole PR only:
// one commit of it, or a local branch, has no boxes.
import { api, esc } from "./core.js";

export async function syncViewed(app) {
  const pr = app.graph.pr;
  if (pr.provider === "local" || pr.commit) return;
  const r = await api("/api/viewed").catch(() => null);
  if (!r?.ok) return;
  const github = r.files; // path → VIEWED | UNVIEWED | DISMISSED, as GitHub has it now
  const ours = (path) => app.filePages(path).length > 0; // a file Bobby shows as pages (not a lockfile, say)
  for (const [path, state] of Object.entries(github)) if (state === "VIEWED" && ours(path) && !app.isFileRead(path)) app.markFile(path, true);
  const known = new Map(Object.keys(github).filter(ours).map((p) => [p, app.isFileRead(p)]));
  let told = false;
  app.on((why) => {
    if (why !== "marks") return;
    for (const [path, was] of known) {
      const now = app.isFileRead(path);
      if (now === was) continue;
      known.set(path, now);
      if (now === (github[path] === "VIEWED")) continue; // GitHub says so already
      github[path] = now ? "VIEWED" : "UNVIEWED";
      api("/api/viewed", { path, viewed: now }).then((x) => { if (!x.ok) throw new Error(x.error); }).catch((e) => {
        if (told) return; // once a visit: it would repeat for every file
        told = true;
        app.toast?.(`<span>Couldn't update GitHub's Viewed box for ${esc(path.split("/").pop())}: ${esc(e.message)}</span>`, 8000);
      });
    }
  });
}
