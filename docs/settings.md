# Settings

Open settings with `,` or the gear in the header. Changes apply immediately and are saved to `~/.bobby/settings.json`, so they carry across PRs.

| Setting | Options | Default |
|---|---|---|
| Style | GitHub · Warm | GitHub |
| Theme | System · Dark · Light | System |
| Reading font | Sans (Inter) · Hyperlegible (Atkinson) · Serif (Literata) · Mono (JetBrains Mono) | Sans |
| Text size | 14 · 15 · 16 · 18 | 15 |
| Word spacing | Normal · Wide · Wider | Normal |
| Motion | System · On · Off | System |
| Key hints | Fade when learned · Always · Hidden | Fade when learned |
| Diff layout | Split · Inline | Split |
| Diff edges | All, faint · Focused only | All, faint |
| Break reminder | Off · 15m · 25m · 45m | Off |
| Rabbit-hole nudge | Off · 8m · 12m · 20m | 12m |
| Drift prompt | On · Off | On |
| PR comments | Hidden, show per page · Always shown | Hidden, show per page |
| Untouched code it relies on | Shown · Hidden (also the top bar's **○ Untouched**) | Shown |
| Tests & generated files | Hidden · Shown (also the top bar's **⚗ Tests**) | Hidden |

**Style** picks the colours. GitHub is the default. Warm is the alternative: warm neutrals with one amber signal colour. GitHub uses GitHub's colours and fonts: its accent blue as the signal, its diff greens and reds, blue hunk rows, its syntax colours, and the system UI and monospace fonts. Either comes in dark and light.

**Tests & generated files** are skipped by default: test files (`*.test.*`, `*.spec.*`, `__tests__/`, `tests/`, fixtures, `test_*.py`, `*_test.go`, …) and generated files (`__generated__/`, `*.generated.*`, `*_pb2.py`, OpenAPI specs, or code carrying a generated-file marker such as `@generated` or "DO NOT EDIT"). Hidden, they leave every view, `j`/`k` and progress; the **⚗ Tests** switch in the top bar brings them back. **Untouched code it relies on** works the same way, with **○ Untouched**. Lockfiles, `dist/` and the like are already set aside on the low-signal page.

"System" follows your OS: light/dark preference for the theme, and the reduced-motion preference for motion. With motion off, every transition and animation is disabled.

## Design choices

These aren't settings, but they're deliberate and worth knowing:

- **One signal colour.** Amber means "you are here" or "needs you". Everything else is warm neutral, so nothing else competes for attention.
- **Shape, not hue, for changed vs untouched.** Changed code is ● and solid; untouched code is ○ and dashed. The core is ◆.
- **Calm diffs.** Muted line tints, word-level highlights, and no code ligatures.
- **Only the focus shows code** at the Core level. Everything else stays a title and a why.
