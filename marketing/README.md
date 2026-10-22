# Bobby marketing site

Static, buildless marketing site for Bobby. One page: a GitHub pull request that turns into a Bobby review as you
scroll, one piece at a time, and ends on the install command.

Preview the isolated site directory:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory marketing
```

Then open `http://127.0.0.1:8080/`. `j` / `k` (or the arrows) step through it. Bump the `?v=` on the assets in
`index.html` when they change; the preview server sends no cache headers.

## How the story works

- `index.html` holds one caption per step (`data-cap="n"`) and one app mock (`.app`), drawn at 1440 × 900 and scaled
  to fit (`site.js`). Every piece of the mock is in the page from the start; a step only shows or hides pieces.
- Each piece says when it changes:
  - `data-out="n"`: gone from step `n` on;
  - `data-in="n"`: there from step `n` on (a new piece settles in with a soft lift; a region that only changes
    capture, like the bar from Diff to Lens, cross-fades in place);
  - `data-at="n"`: a moment (a ping, a dialog), there only at step `n`.
- The app also carries `s1` … `sN`, every step reached, so the layout can move with it (`.app.s2 .gh-diffs { … }`).
- Scrolling picks the step (each takes 70% of the window's height); the transitions are time-based, so a step plays
  the same however fast you scroll.

The story walks Bobby's own views, Diff (steps 3 and 4, then the inspector on the same file in 5 and 6), Lens (7)
and Conversation (14), to show it keeps the GitHub review you know. To add a step: add a caption with the next `data-cap`, then tag what leaves and what arrives with that
number. Keep each step to one GitHub piece out and one Bobby piece in, and name both in the caption's **Out** / **In**
lines.

Above the captions on wide screens, Bobby's head floats and watches the cursor (`buddy.js`: transforms on the inline
SVG's parts, eased each frame). It glances at the app when the step changes, hops at the approval, and stays still
for reduced motion.

## Two pages in one frame

- **GitHub** is hand-built HTML in `index.html` (`.gh-*`, styled in `styles.css`): the PR's Files changed tab, in
  GitHub's light theme. Its diff, between `<!-- gh-diff -->` and `<!-- /gh-diff -->`, is generated from the demo PR's
  real `git diff`.
- **Bobby** is the real app, captured, so it follows the app's design rules by construction. `bobby.js` holds the
  app's CSS and, for each story state (`diff`, `lens`, `lens-draft`, `progress`, `park`, …), the HTML and box of each
  of its regions (`top`, `where`, `view`, `files`, `keys`, `overlay`, `toast`, `inspector`). A layer names one:

  ```html
  <div class="bl" data-state="lens" data-region="view" data-in="7" data-out="9"></div>
  ```

  `site.js` draws the layers in shadow roots (`[data-bobby]`) with the app's own CSS, so its styles and the site's
  never meet. `data-later=".side"` with `data-later-in="6"` holds part of a layer back until a later step.
- **Between the two**, step 3 flies each file of GitHub's list (`[data-morph]`) to its viewer on Bobby's zoomed-out
  canvas (`data-zoom`), matched by path; step 4 zooms the canvas into one file, whose focused view (`data-zoom-from`)
  grows out of the same spot. `site.js` measures both moves on the drawn pages, at load and on resize.

The site around the mock keeps the app's rules too: 3px corners, and the current thing marked by weight rather than
an underline, a left bar or a ring.

## Docs

`docs/` is the repo's docs as pages of the site: `docs/*.md` and `SPEC.md`, rendered by `scripts/docs.ts` (Bun's own
Markdown) with the site's header, a sidebar, the page's sections and prev/next. The Markdown is the source; after
editing it, run `bun run docs` and commit the pages with it. `bun run check` (and so every commit) fails while a page
is out of date. Links between docs become links between pages, and heading anchors match GitHub's, so `views.md#lens`
still works; anything else in the repo links to GitHub. The page chrome is `docs/docs.css` and `docs/docs.js`.

## Re-capturing Bobby

When the app changes, capture it again so the mock stays a copy of the real thing:

```sh
marketing/capture/run.sh            # BOBBY=<a checkout> marketing/capture/run.sh captures another version
```

It builds the demo PR (`capture/demo-repo.sh`: acme/payments #482, "Retry failed charges safely") and extracts it,
with `capture/tree.json` standing in for Claude's answer so it needs no login. Then it opens the PR in that checkout's
Bobby with a fresh state, drives it through the story (`capture/capture.mjs`), and writes `bobby.js`, keeping only
the states and regions `index.html` uses. It also regenerates the GitHub diff. Pass a directory to get a screenshot
of each state.

Nothing reaches GitHub: the token is a dud, avatars are drawn as initials, and the Conversation view's timeline is the
story's own, served to the page in place of GitHub's. Needs bun, node, python3 and Chrome (`$CHROME`).
