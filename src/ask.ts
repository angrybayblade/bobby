// Asking Claude about some lines of the PR: select them, ask, and Claude answers there, as it writes, after checking
// the code around them (the same read-only setup as Claude's review, agent.ts). Follow-ups carry the conversation so
// far. The answer is for you, the reviewer: turn it into a comment or a note if you want to keep it.
import { type AgentJob, TOOLS_NOTE, runClaude } from "./agent.ts";
import type { ReviewGraph } from "./graph.ts";
import { refContext, resolveRefs } from "./refs.ts";
import type { Ask } from "./types.ts";

const INSTRUCTIONS = `A reviewer is reading this pull request and has selected some lines to ask you about. Answer their question directly, for them (not for the PR's author).

Check the code before you answer: your working directory is the repository at the PR's head commit, and you have Read, Grep and Glob. Look up what the lines call and what calls them when the answer depends on it. Cite code as Markdown links with its path from the repository's root: [what it is](path/to/file.ts#L12), or a range [what it is](path/to/file.ts#L12-L20); for the code as it was before the PR, path/to/file.ts#base-L12. Cite only lines you've read, so each link opens the right code.

Be concise: usually under 200 words, in Markdown, with no preamble and no restating of the question. If they ask you to review the lines, list concrete problems, worst first, or say plainly there are none. If you're not sure, say what you checked and what's left open.`;

/** The prompt for the ask's last question: the PR, the file's diff with the selected lines marked, and the turns before. */
export function askPrompt(g: ReviewGraph, ask: Ask, tools = false): string {
  const lo = ask.startLine ?? ask.line, hi = ask.line;
  const picked = (l: { t: string; o: number | null; n: number | null }) => (ask.side === "LEFT" ? l.t === "-" && l.o! >= lo && l.o! <= hi : l.t !== "-" && l.n! >= lo && l.n! <= hi);
  const hunks = g.hunks.filter((h) => h.file === ask.path);
  const diff = hunks.map((h) => [h.header, ...h.lines.slice(0, 600).map((l) => `${picked(l) ? ">>" : "  "} ${l.t === "-" ? `L${l.o}` : `R${l.n}`}\t${l.t}${l.s}`)].join("\n")).join("\n").slice(0, 120_000);
  const selected = hunks.flatMap((h) => h.lines.filter(picked).map((l) => `${l.t}${l.s}`)).join("\n");
  const turns = ask.turns.slice(0, -1);
  const parts = [INSTRUCTIONS, ...(tools ? ["", TOOLS_NOTE] : []), "", `# PR: ${g.pr.title}`, `What it does: ${g.intent}`, "",
    `# The diff of ${ask.path} (R<n>: the new file's lines, L<n>: the old file's; >> marks the selected ones)`, diff || "(not in the diff)", "",
    `# The selected lines: ${ask.path}, ${ask.side === "LEFT" ? "old" : "new"} file, ${lo === hi ? `line ${hi}` : `lines ${lo}–${hi}`}`, selected || "(see the file)"];
  if (turns.length) parts.push("", "# Earlier in this conversation", ...turns.flatMap((t) => [`Reviewer: ${t.q}`, `You: ${t.a ?? "(no answer)"}`]));
  parts.push("", "# The reviewer asks", ask.turns.at(-1)!.q);
  return parts.join("\n");
}

/** Answers the ask's last question; job.text is the answer so far, and done gets the whole of it, or the error. */
export async function runAsk(cwd: string, g: ReviewGraph, ask: Ask, job: AgentJob & { text?: string }, done: () => void, tools?: string): Promise<void> {
  const turn = ask.turns.at(-1)!;
  try {
    const r = await runClaude(cwd, g, job, askPrompt(g, ask, !!tools), { onText: (t) => { job.text = t; }, minutes: 10, tools });
    turn.a = await resolveRefs((r.result ?? job.text ?? "").trim(), refContext(cwd, g));
  } catch (e) {
    turn.error = job.error ?? (e as Error).message;
    if (job.text) turn.a = job.text.trim(); // what it had written, stopped
  } finally {
    job.done = true;
    done();
  }
}
