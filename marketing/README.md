# Bobby marketing site

Static, buildless marketing site for Bobby. One page: a GitHub pull request that turns into a Bobby review as you
scroll, one piece at a time, and ends on the install command.

Preview the isolated site directory:

```sh
python3 -m http.server 8080 --bind 127.0.0.1 --directory marketing
```

Then open `http://127.0.0.1:8080/`. `j` / `k` (or the arrows) step through it.

## How the story works

- `index.html` holds one caption per step (`data-cap="n"`) and one app mock (`.app`), drawn at a fixed 1040 × 660
  and scaled to fit (`site.js`). Every piece of the mock is in the markup from the start; a step only shows or hides
  pieces.
- Each piece says when it changes:
  - `data-out="n"`: a GitHub piece, gone from step `n` on;
  - `data-in="n"`: a Bobby piece, there from step `n` on (it flashes as it arrives);
  - `data-at="n"`: a moment (a ping, a dialog), there only at step `n`.
- The app also carries `s1` … `sN`, every step reached, so the layout can move with it (`.app.s4 .bb-core { … }`).
- Scrolling picks the step (each takes 70% of the window's height); the transitions are time-based, so a step plays
  the same however fast you scroll.

To add a step: add a caption with the next `data-cap`, then tag what leaves and what arrives with that number.
Keep each step to one GitHub piece out and one Bobby piece in, and name both in the caption's **Out** / **In** lines.

## Theme

The mock is GitHub's light theme throughout: `.app` redefines the colour and font tokens with GitHub's own values, so
the Bobby pieces arrive looking native to the page they replace. Only the site around the mock (header, captions)
uses Bobby's warm palette.
