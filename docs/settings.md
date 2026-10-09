# Settings

Open settings with `,` or the gear in the header. Changes apply immediately and are saved to `~/.prfocus/settings.json`, so they carry across PRs.

| Setting | Options | Default |
|---|---|---|
| Theme | System · Warm dark · Warm light | System |
| Reading font | Sans (Inter) · Hyperlegible (Atkinson) · Serif (Literata) · Mono (JetBrains Mono) | Sans |
| Text size | 14 · 15 · 16 · 18 | 15 |
| Word spacing | Normal · Wide · Wider | Normal |
| Motion | System · On · Off | System |
| Key hints | Fade when learned · Always · Hidden | Fade when learned |
| Diff edges | All, faint · Focused only | All, faint |
| Break reminder | Off · 15m · 25m · 45m | Off |

"System" follows your OS: light/dark preference for the theme, and the reduced-motion preference for motion. With motion off, every transition and animation is disabled.

## Design choices

These aren't settings, but they're deliberate and worth knowing:

- **One signal colour.** Amber means "you are here" or "needs you". Everything else is warm neutral, so nothing else competes for attention.
- **Shape, not hue, for changed vs untouched.** Changed code is ● and solid; untouched code is ○ and dashed. The core is ◆.
- **Calm diffs.** Muted line tints, word-level highlights, and no code ligatures.
- **Only the focus shows code** at the Core level. Everything else stays a title and a why.
