# Commit rules

There are three rules, and each answers one question about a commit:

| Rule | Question |
|---|---|
| **Micro** | Is it *one* thing? |
| **Incremental** | Does the project still work after it? |
| **Semantic** | Can you tell what it is from the subject line alone? |

The hooks in `.githooks/` enforce what a machine can check. Run `bun install` once and the `prepare` script turns them on via `git config core.hooksPath .githooks`.

---

## 1. Micro: one logical change per commit

A commit does exactly one thing you could describe in a single sentence without using "and".

**Do**
- Split refactors from behaviour changes. Rename or move first, then change behaviour in the next commit.
- Split formatting and whitespace from real edits.
- Split dependency bumps from the code that uses them.
- Use `git add -p` to stage part of a file when it holds two changes.

**Don't**
- Mix a fix with a feature. Each gets its own commit.
- Bundle "and also fixed a typo over here" into the same commit.
- Commit generated output alongside hand-written source, unless the generator requires it. Lockfiles go with the `package.json` change that caused them.

**Size guide.** Aim for under about 200 changed lines, excluding lockfiles and snapshots. The pre-commit hook **warns** above 400 lines. It's a smell, not a ban: a single new self-contained module can be bigger.

## 2. Incremental: every commit leaves the tree working

You should be able to check out any commit and have it build, and `git bisect` should never land on a broken step.

**Do**
- Make sure every commit passes `bun run check` (typecheck plus a JS syntax check). The pre-commit hook runs it.
- Build bottom-up: types → logic → wiring → UI → docs. A commit may add code nothing calls yet; it may not *call* code that doesn't exist yet.
- Land a large feature as a series of commits, each adding one layer: the format, then the producer, then the consumer.
- Keep an unfinished user-facing feature behind its entry point. For example, add the view module first and register it last.

**Don't**
- Commit a "WIP" that doesn't build. Use `git stash`, or a `fixup!` commit that you squash before sharing.
- Fix the previous commit in a new commit once it's shared. Before sharing, use `git commit --fixup <sha>` and `git rebase -i --autosquash`.

## 3. Semantic: the subject says what kind of change it is

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <subject>

<body: why, not what. Wrap at 72.>

<footers: BREAKING CHANGE: …, Co-Authored-By: …>
```

**Types**

| type | use for | user-visible? |
|---|---|---|
| `feat` | a new capability | yes |
| `fix` | a bug fix | yes |
| `perf` | faster or leaner, same behaviour | maybe |
| `refactor` | restructure, same behaviour | no |
| `style` | formatting only; no logic change | no |
| `test` | add or adjust tests | no |
| `docs` | documentation only | no |
| `build` | tooling, dependencies, scripts, hooks | no |
| `ci` | CI configuration | no |
| `chore` | anything else that isn't shipped | no |
| `revert` | `revert: <original subject>` | – |

**Scopes.** Use the part of the system the change touches:

| Layer | Scopes |
|---|---|
| Extraction | `git`, `diff`, `analyze`, `llm`, `graph` |
| Server and CLI | `state`, `server`, `cli` |
| Shared UI | `ui`, `theme`, `code`, `chrome` |
| Views | `view/flow`, `view/outline`, `view/lens` |
| Docs and tooling | `spec`, `readme`, `commits`, `hooks`, `deps` |

Omit the scope only when a change is truly global.

**Subject line**
- Use the imperative mood, as if completing "this commit will…": `add`, `fix`, `fold`. Not `added` or `adds`.
- Start lowercase and leave off the trailing period.
- Keep it to 72 characters or fewer, including type and scope.
- Say what changed for the *user or reader*, not which file you edited.

**Breaking changes.** Mark them with `!` after the scope, plus a `BREAKING CHANGE:` footer. Example: `feat(graph)!: rename placements to slots`. Any change to the review-graph schema that existing consumers can't read is breaking, and needs a new schema version (`/v2`).

**Body.** Use one only when the *why* isn't obvious from the subject. Explain the motivation and any trade-off. The diff already shows the *what*.

**Good**
```
feat(view/lens): slide the ring toward the side the new focus came from
fix(code): keep the comment composer open when marks change
refactor(analyze): extract parseGrep from analyze
build(hooks): warn on commits over 400 changed lines
```

**Bad**
```
update stuff                      → no type, says nothing
feat: Added new view.             → past tense, capitalised, period, no scope
fix(ui): fix bug and add settings → two changes ("and"): split it
```

---

## Checklist before `git commit`

1. Is it one thing? (`git diff --cached --stat`)
2. Does `bun run check` pass? The hook runs it anyway.
3. Does `<type>(<scope>): <subject>` read correctly as "this commit will …"?
