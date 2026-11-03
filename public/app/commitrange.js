// Which of a PR's commits a review covers, and how it's written: the reckoning behind commits.js, free of the page.
export const short = (sha) => sha.slice(0, 4);
export const rangeText = (a, b) => (a === b ? short(a) : `${short(a)}...${short(b)}`);

/** The commits this review covers, as positions in the PR's list; null if it isn't a stretch of them (a force-push
 *  since it opened, or a range that starts off the PR's first-parent line). */
export function spanOf(list, pr) {
  if (!list.length) return null;
  if (!pr.commit) return [0, list.length - 1];
  const hi = list.findIndex((c) => c.sha === pr.commit.sha);
  if (hi < 0) return null;
  if (!pr.commit.from) return [hi, hi];
  if (pr.commit.from === list[0].parent) return [0, hi];
  const before = list.findIndex((c) => c.sha === pr.commit.from);
  return before >= 0 && before < hi ? [before + 1, hi] : null;
}
/** What the crumb says: the first and last commit reviewed, or one alone. Without the list, what the review knows. */
export function crumbText(list, pr) {
  const s = spanOf(list, pr);
  if (s) return rangeText(list[s[0]].sha, list[s[1]].sha);
  return pr.commit ? rangeText(pr.commit.from ?? pr.commit.sha, pr.commit.sha) : "";
}
/** The PR's URL for a stretch of its commits: what /api/open takes. All of them is the whole PR. */
export function argFor(list, lo, hi, prUrl) {
  if (lo === 0 && hi === list.length - 1) return prUrl;
  return lo === hi ? `${prUrl}/changes/${list[hi].sha}` : `${prUrl}/changes/${list[lo].parent}..${list[hi].sha}`;
}
/** A click on a commit: it alone, or with a commit clicked just before it (or with shift), all between them. */
export function pick({ lo, hi, anchor }, i, extend = false) {
  const from = anchor ?? (extend ? lo : null);
  return from == null ? { lo: i, hi: i, anchor: i } : { lo: Math.min(from, i), hi: Math.max(from, i), anchor: null };
}
