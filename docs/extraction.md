# Extraction pipeline

How a PR becomes a review graph. The code lives in `src/`; the output format is in [SPEC.md](../SPEC.md).

## 1. Resolving the PR (`git.ts`)

`parsePrArg` accepts a full PR URL or a bare number. A bare number needs the current directory to be a clone of the repo.

`resolvePr` runs `gh pr view --json number,title,body,url,author,baseRefName,baseRefOid,headRefOid`, then picks the clone:

1. `--repo <dir>` if given (it must have a remote pointing at the PR's repo);
2. otherwise the current directory, if any remote's URL matches `owner/repo`;
3. otherwise `~/.bobby/repos/<owner>/<repo>`, cloned with `gh repo clone -- --no-tags` on first use.

`resolvePr` doesn't fetch, so it's cheap enough to run on every launch. That's what makes the cache check possible.

**No PR (`local.ts`).** With no PR argument, `resolveLocal` reviews the branch you're on. `detectBase` picks the base (`--base`, the branch's PR base via `gh pr view`, `origin/HEAD`, then common names), and asks on a TTY if none is found. `baseSha` is the merge-base with `HEAD`. For uncommitted changes, `git stash create` snapshots tracked files without touching anything, and `headSha` is that snapshot's **tree** id: it's stable while the files are, so caches still hit, and `git diff`, `git grep` and `git show` all accept it. The `PrInfo` has `provider: "local"`, `number: 0`, an empty `url`, `branch` and `baseRef`; the title comes from the commit subjects. There are no review comments, and `/api/submit` refuses to post.

`fetchPr` then fetches `refs/pull/<n>/head` and the base branch into `refs/bobby/<n>/head` and `.../base`. The diff base is the **merge-base** of the base tip and the head, so the diff matches what GitHub shows. Because the diff is computed locally, GitHub's patch-size truncation doesn't apply.

## 2. Parsing the diff (`diff.ts`)

`git diff --no-color --no-ext-diff -M -U3 <base> <head>` is parsed into `FileDiff[]`, each holding `Hunk[]`:

- Status (added, deleted, modified, renamed) and binary files are detected from the extended headers.
- Each line records its kind (`" "`, `+`, `-`) and its old and new line numbers.
- Hunk ids are `h1…hN` in file order.
- **`hunk.hash`** is a SHA-1 of the file path plus the hunk's lines. It's identical across force-pushes when the hunk didn't change, and review marks are keyed on it.

**Low-signal classification.** A hunk gets a `noise` reason if its file is a lockfile (`package-lock.json`, `bun.lock`, `go.sum`, …), generated (`dist/`, `vendor/`, `*.min.js`, `*.pb.go`, snapshots, …) or binary, or if the hunk is whitespace-only (added and removed lines are equal once whitespace is stripped). Low-signal hunks skip analysis and end up on the single "Low-signal changes" page.

## 3. Static analysis (`analyze.ts`, `syntax.ts`, `resolve.ts`)

For **TypeScript, TSX, JavaScript, Python, Go, Java and Rust**, analysis reads code through its syntax tree and its imports. Other languages fall back to text search, described at the end of this section.

### Reading code (`syntax.ts`)

Each file is parsed with [tree-sitter](https://tree-sitter.github.io/), which runs as WebAssembly, so it works under bun and inside the compiled binary. The grammars are embedded in the binary. A parsed file gives:

- its **declarations**: whether each is at module level, a member (a method or field of a class, struct, trait or interface), or a local;
- every **reference** to a name, with what it's reached through (`db` in `db.create()`, `pkg` in `pkg.Name`). Comments, strings and import lines never count;
- its **imports**: which local name binds which exported name of which module;
- its **re-exports**.

### Resolving imports (`resolve.ts`)

`Repo` reads the repo at the PR's head through git, without a checkout, and says which file an import refers to:

| Language | Resolves |
|---|---|
| TS/JS | Relative paths. `tsconfig`/`jsconfig` `paths` and `baseUrl`, following `extends`, including into workspace packages. Workspace packages by their `package.json` name, through `source`/`module`/`types`/`main`/`exports`. Extension and `index` rules, including `.js` written for a `.ts` file. |
| Python | Relative (`from .a import b`) and absolute (`a.b.c`) modules, and `__init__.py`. When several files match, the one nearest the importer wins. |
| Go | Import paths through the repo's `go.mod` modules, to a package directory. |
| Java | Fully qualified class names, and `a.b.*` packages. |
| Rust | `crate::`, `super::` and `self::` paths, to module files. |

`findDecl` follows re-exports (`export { x } from`, `export * from`) to the file that actually declares a name. Anything that resolves outside the repo, such as a library, resolves to nothing.

### Units

Hunks are grouped into **units** by file and **primary symbol**:

1. A module-level declaration on the hunk's added lines, then a method.
2. Failing that, the innermost declaration or method around the change.
3. Failing that, the old pattern-based guess.

One-line members (fields) are left out: their names are too generic to follow. Declarations removed by the hunk are kept as symbols too, because their remaining callers matter. Docs and data files (Markdown, JSON, YAML…) are named after the file and never read for declarations.

### Downstream: who uses what changed

1. One `git grep` pass (a single PCRE alternation, or `-E` when git has no PCRE) finds the files that mention any changed name.
2. Each of those files is parsed, and a reference counts only if it **binds to the owner's declaration**:
   - it's in the owner's file;
   - or the name, or its namespace (`ns.name`, `pkg.Name`), is imported from a module that resolves to the owner's file, re-exports included;
   - or, for Go and Java, it's in the same package;
   - or, for a member reached through a value (`x.method()`), the file imports the class that declares it.
3. A binding on **another unit's added line** becomes an edge `owner → that unit` ("uses `symbol`"). One in **untouched code** becomes a downstream ref (`dir: "down"`): at most 10 per symbol and 2 per file, and none for a symbol used more than 120 times.

### Upstream: what the new code relies on

Each name referenced on a unit's added lines is resolved to its **one declaration**:

- through the file's imports and re-exports;
- otherwise to the file's own module-level declarations;
- otherwise to its Go or Java package;
- otherwise through its wildcard imports.

Names reached through a value (`x.member`) aren't resolved. Declarations that are themselves changed code are left to the downstream pass, as edges. The others become upstream refs (`dir: "up"`), up to 6 per unit, ranked by how often the unit uses them.

### Fallback: text search

Files in other languages, and everything when tree-sitter can't load, use the earlier method:

- `declsIn`, a set of language-agnostic patterns, finds declarations;
- downstream uses are whole-word `git grep` matches that aren't declarations or import lines;
- upstream refs are identifiers with **exactly one** definition-looking line elsewhere in the repo.

Matches in docs and data files are ignored.

The result is an `Analysis`: `units`, `refs`, `edges` (unit → unit) and `hunkById`.

## 4. Change trees

A **change tree** (`ChangeTree` in `types.ts`) is the intermediate shape: cores, each with five bands of `TreeNode`s. A node points at units (changed code) or at a ref (untouched code). Two producers make one.

### The static tree (`heuristicTree`)

Deterministic and instant:

1. Units are ordered so that ones nothing changed depends on come first, then by weight (3 × downstream edges + downstream refs).
2. Each unit not yet placed starts a core. Its static edges pull in `upChanged` and `downChanged` units.
3. Refs fill the untouched bands: up to 4 upstream and 6 downstream for the core unit, and fewer for its neighbours. Downstream refs default to `risk: "med"`.

### Claude's tree (`llm.ts › claudeTree`)

Runs `claude -p --output-format json --tools "" --no-session-persistence --json-schema <schema>` in a temp directory, with the prompt on stdin. `BOBBY_MODEL` adds `--model`.

- **The prompt** has instructions written for a reviewer who reads one focused page at a time, then the PR title and body, every unit with its hunks (up to 120 lines each, within a ~160k-character budget), the static edges, and every ref.
- **The schema** forces exactly the five band lists per core, plus a `hook` per core: one question to lead with. Each entry carries an id, a label, a why, `attachTo` (the unit one step closer to the core) and `relation` (a 1–4 word edge label). Refs also carry a risk.
- **Guard rails**: Claude may only use the ids it was given. Unknown ids are dropped, cores without a valid core unit are dropped, and any leaked ids in prose (`u3`, `r12`) are replaced with the symbol name.

`attachTo` and `relation` travel as hints into graph building, where they choose edge endpoints and labels.

### `finalize`

Both trees go through `finalize`:

- Ids are assigned (`c1…`, `n1…`) and duplicates within a band are dropped.
- A node whose units or ref were already shown gets `seenIn`, which becomes `repeatOf` in the graph.
- **Coverage guarantee**: units that appear nowhere are appended as extra cores, one per file ("Remaining changes in …"), so no hunk is ever skipped.
- `noiseHunkIds` lists every low-signal hunk.

## 5. Building the graph (`graph.ts › buildGraph`)

`buildGraph` packs the diff, analysis and tree into a `ReviewGraph`:

- **Nodes**: one `change` node per unit (`chg:<file>#<symbol>`), and one `context` node per referenced location (`ctx:<path>:<line>`). Context nodes carry a snippet of ±10 lines read with `git show <head>:<path>`.
- **Placements**: each tree node becomes a placement `p1…` in its core's band, with its title, why and risk. Repeats get `repeatOf`.
- **Hooks**: Claude's, or `staticHook` when the tree has none, built from the core's untouched downstream code (risky first), then its downstream changes.
- **Edges** (`coreEdges`), inside each core:
  - Each upstream placement feeds one node on its right. An untouched upstream node may feed an upstream changed node or a core node; an upstream changed node feeds a core node.
  - Each downstream placement hangs off one node on its left, in the mirror-image way.
  - The endpoint is chosen by Claude's `attachTo` hint if present, otherwise by a matching static relation, otherwise the first core node.
  - The label is Claude's `relation`, else the static relation ("uses `x`", "relies on `x`").
- **Walk**: cores in order, bands in order, repeats left out.
- **Discussion**: existing inline review comments (`reviewComments`, via paginated `gh api .../pulls/<n>/comments`), keeping only those still anchored to a line.

`VERSION` in `graph.ts` is stamped into `generator.version`. **Bump it whenever extraction output changes**: cached graphs with a different version are rebuilt on the next launch.

## 6. Caching (`cli.ts`, `state.ts`)

Keyed by `owner_repo_number_<first 12 of head sha>` in `~/.bobby/cache/`:

| File | Holds | Written |
|---|---|---|
| `….graphs.json` | `{ static, claude? }` built graphs | After the static graph is built, and again when Claude's is ready |
| `….json` | Claude's raw `ChangeTree` | When Claude finishes |

On launch, a cache hit with a matching `VERSION` skips fetch, diff, analysis and graph building, and only refreshes `discussion`. If the static graph is cached but Claude's isn't, extraction runs lazily only when Claude needs it. `--refresh` ignores both caches.
