# Review graph v2: authored graphs

Status: **draft**, not built. Proposed after 0.1.0.

`bobby.review-graph/v2` lets the author of a pull request say how it should be reviewed: which changes belong together, in what order to read them, and the decisions behind them. Bobby renders it as it renders its own graphs, so the reviewer reads the PR in the author's order. It can be shared through the hub ([hub.md](hub.md)).

v2 graphs are written by an LLM agent working for the author, with Bobby's tools (below). People don't write them by hand, and Bobby doesn't take hand-written ones from the hub. Nothing in the format stops a person writing one; it's just not what it's designed for.

## What changes from v1

| | v1 (`SPEC.md`) | v2 |
|---|---|---|
| Written by | Bobby's extraction | The author's agent |
| Code | Carries the diff: hunks, lines, snippets | **No code at all.** It names a repository and two commits, and points at changes by path and line |
| Ids and hashes | Hunk ids, content hashes, unit ids | None to produce. Steps point at lines; Bobby works out the rest |
| Decisions, walkthrough, map | Not in the graph (Map is built separately) | Part of the graph |
| Discussion, definitions | In the graph | Not in it: Bobby fetches them, as they aren't the author's to say |

v1 stays. It becomes what Bobby builds internally and what views read: Bobby compiles a v2 graph into a v1 graph against the real diff (see [Compiling](#compiling-a-v2-graph)). `bobby open` keeps opening v1 files.

## The document

```jsonc
{
  "schema": "bobby.review-graph/v2",
  "repo": { "host": "github.com", "owner": "acme", "name": "payments" },
  "pr": 482,                                   // optional: a graph can describe two commits with no PR
  "base": "9f1c2e7…",                          // full SHAs: the diff is base..head
  "head": "4be0a1d…",
  "author": { "agent": "claude-code", "model": "claude-opus-5-5" },
  "intent": "Move rate limiting from the gateway into the API, so limits apply per org.",
  "overview": "Markdown. Where to start and what matters most, in the author's words.",
  "decisions": [ … ],
  "cores": [ … ],
  "walk": [ … ],                               // optional
  "lowSignal": [ … ],                          // optional
  "map": { … }                                 // optional
}
```

`base` and `head` are full commit SHAs. For a PR, `base` is the merge base of the PR's base branch and `head` (what GitHub's "Files changed" compares), and `head` is the PR's head commit when the graph was written. Every line number in the graph refers to one of these two commits, so a graph stays true after the branch moves on. It just describes an older head (see [New commits](#new-commits)).

The hub fills in who uploaded it (`uploadedBy`, a GitHub login) and when. A graph doesn't claim its own author.

### Ranges: pointing at code

A range is a run of lines in one file, at one of the graph's two commits:

```jsonc
{ "path": "src/limits/enforcer.ts", "start": 40, "end": 61 }                 // at head (the default)
{ "path": "src/gateway/limit.ts", "side": "base", "start": 12, "end": 30 }   // at base: for removed code
```

- `side` is `"head"` (the default) or `"base"`. Use `base` for code the PR removes, and for a file it deletes.
- `path` is the file's path at that side's commit. A renamed file is named by its new path at `head` and its old one at `base`.
- `start` and `end` are 1-based and inclusive. Omit both to mean the whole file's changes.
- A range can cover changed lines, untouched lines, or both. Untouched lines become context: code the change relies on or affects.

That's the only way a graph refers to code. Bobby turns ranges into hunks; the author's agent never sees hunk ids.

### Cores and steps

As in v1, a **core** is one idea the PR carries out, with what surrounds it in bands. v2 drops the node/placement split: each entry in a band is a **step**, the code it shows and what the author says about it.

```jsonc
{
  "id": "per-org-limits",                      // the author's own ids: kebab-case, unique in the graph
  "title": "Count requests per org",
  "summary": "One or two sentences: what this part does.",
  "hook": "Do requests without an org still get the default limit?",
  "decisions": ["redis-over-memory"],          // ids from decisions[]
  "bands": {
    "upUnchanged":   [ step, … ],
    "upChanged":     [ … ],
    "core":          [ … ],
    "downChanged":   [ … ],
    "downUnchanged": [ … ]
  }
}
```

The bands mean what they mean in v1: untouched code the core relies on, changed code it relies on, the core change itself, changed code that follows from it, and untouched code whose behaviour it can change. Any band may be empty except `core`.

A step:

```jsonc
{
  "id": "enforcer-check",
  "title": "The limiter checks the org's bucket",
  "why": "Why this matters here, for the reviewer. Markdown, a few sentences at most.",
  "ranges": [ { "path": "src/limits/enforcer.ts", "start": 40, "end": 61 } ],
  "risk": "high",                              // optional: high | med | low
  "after": "redis-scripts",                    // optional: the step one closer to the core, which this one hangs off
  "relation": "calls `consume()`"              // optional: the edge's label
}
```

A step's ranges should fit its band: changed lines in a changed band, untouched lines in an unchanged one. Compiling reports a step that doesn't fit, and still shows it.

### Decisions

A decision is a choice the author made and why, with the code it shaped:

```jsonc
{
  "id": "redis-over-memory",
  "title": "Count in Redis, not in memory",
  "why": "Limits must hold across the API's replicas.",
  "alternatives": [ { "option": "In-memory counters", "rejected": "Each replica would allow the full limit." } ],
  "ranges": [ … ]                              // optional: where it shows in the code
}
```

Cores and steps name the decisions behind them. A reviewer sees a core's decisions when entering it, and every decision on the PR's overview.

### Walk

`walk` is optional: step ids in the order to read them. Without it, the order is the v1 walk: cores in order, bands in order within each core. A step left out of an explicit walk is put back at the end of its core, and compiling warns about it.

### Low signal

`lowSignal` lists changes the reviewer can skip, each with a reason:

```jsonc
[ { "ranges": [ { "path": "pnpm-lock.yaml" } ], "reason": "lockfile" } ]
```

### Map

`map` is optional: the behaviour map the Map view draws, in the same shape Bobby's own map has today (`scope`, `effect`, `summary`, and `layers` of nodes and edges, each marked same, added, removed or changed). Its nodes may carry `ranges`, so a reviewer can go from a part of the diagram to its code. Without it, the Map view offers to build one, as it does now.

## Compiling a v2 graph

Bobby turns a v2 graph into the v1 graph its views read. It does this when it opens one, and `bobby graph check` does it on its own.

1. **Get the code.** Fetch the repository, find both commits, and diff `base..head` with Bobby's usual settings. If either commit is missing, stop: the graph can't be checked.
2. **Place each range.** A range on changed lines takes the hunks it overlaps; the step shows those hunks whole, with the range's lines marked. A range on untouched lines becomes a context snippet, read from that side's commit. A range that runs past the end of its file, or names a file that isn't there, is an error on that step.
3. **Build the graph.** Steps become nodes and placements, ranges' hunks become units, `after` becomes edges. Then add what Bobby fetches itself: the PR's title and description, its review discussion, and definitions for the inspector.
4. **Check coverage.** Every changed hunk must be in at least one step, or in `lowSignal`. Hunks that are in neither are **uncovered**.

The result has the compiled graph and a report:

```jsonc
{
  "ok": false,                                  // false: there's at least one error
  "coverage": { "hunks": 77, "covered": 74, "lowSignal": 1, "uncovered": [ { "path": "src/api/auth.ts", "start": 88, "end": 97 } ] },
  "errors":   [ { "step": "enforcer-check", "message": "src/limits/enforcer.ts has 58 lines at head; the range ends at 61" } ],
  "warnings": [ { "step": "gateway-old", "message": "untouched lines in the core band" } ]
}
```

A step with an error is still shown, marked, with whatever of it could be placed. An uncovered hunk is never hidden.

## How a reviewer sees it

### Author's graph and Bobby's graph

When a PR has an authored graph, Bobby opens it and **doesn't build its own graph until asked**: no Claude tree runs. It still reads the code, fetches the discussion and starts the language servers, since the graph doesn't replace those.

The breadcrumb bar shows whose graph you're reading, with a switch:

- **Author's graph**: who uploaded it, from the hub, and how much of the PR it covers ("74 of 77 changes").
- **Bobby's graph**: Bobby's own, as today. The first time you pick it, Bobby builds it (its static graph at once, Claude's when it's ready). After that, switching is instant.

Switching graphs keeps your progress. Marks, drafts and notes are kept by the content of each change, not by the graph, as now ([Stability rules](../SPEC.md#stability-rules-for-review-state)).

### What the author didn't cover

Uncovered changes get their own page at the end of the walk, **Not in the author's graph**, as the low-signal page has its own. It shows each one in full and says how many there are. The progress bar counts them, so a review isn't done until they're read. The author decides the order and the story, but never what the reviewer can see.

## New commits

A graph describes one `head`. When the PR moves on and no new graph has been uploaded:

1. **Carry over.** Bobby diffs the graph's `head` against the PR's new head. Each range on code that hasn't changed is moved to its new line numbers; that needs no LLM.
2. **Follow up.** If anything is left over (new changes, or changed code under a step), Bobby's Claude writes a follow-up: given the author's graph, what carried over and the commits since, it places the new changes in the author's cores, or adds cores for them, in the author's terms. This runs on its own when Claude is set up, as it extends the author's graph rather than replacing it. Without Claude, the left-over changes are uncovered.
3. **Label it.** Steps and cores Bobby added are marked as Bobby's, and the bar says so: "Author's graph, at 4be0a1d, with Bobby's follow-up for 3 new commits". A step whose code changed under it keeps the author's words, marked "changed since".

If the author's agent later uploads a graph for the new head, it replaces the follow-up.

## Writing one: tools for agents

Agents write v2 graphs with Bobby installed, through the CLI or `bobby mcp`:

| Tool | CLI | What it does |
|---|---|---|
| `graph_schema` | `bobby graph schema` | The v2 JSON schema, and a short guide to writing a good graph |
| `check_graph` | `bobby graph check <file>` | Compiles the graph against the real diff and returns the report above. Exits non-zero on errors |
| `push_graph` | `bobby graph push <file>` | Checks it, then uploads it to the hub. Refuses a graph with errors; uploads one with uncovered changes only with `--allow-uncovered` |

Bobby's own diff tools (`pr_diff`, `read_file` and the rest) give the agent line numbers that match what `check_graph` expects.

A skill, `bobby-author`, teaches the work: read the PR's diff and the code around it, find the cores, write down the decisions, write the graph, check it, fix what the check reports, and push it. The agent iterates until the check passes with no uncovered changes, or says why some changes are left out.

## Versions

The `$schema` is `schema/review-graph.v2.schema.json`, written with this spec once it's agreed. v2 follows the same rule as v1 until 1.0: it may change without a new name, and fields added later are optional.

## Open questions

1. **Graphs without a PR.** `pr` is optional so a graph can describe two commits. Is that worth supporting in the first version, or PRs only?
2. **Several authored graphs.** The hub keeps one graph per PR head. Should Bobby show who else uploaded one, or only the latest?
3. **Follow-up cost.** The follow-up runs on its own when Claude is set up. Should it ask first, as Bobby's own Claude review does?
