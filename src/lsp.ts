// A minimal Language Server Protocol client: JSON-RPC over a server's stdin/stdout. Only what Bobby asks for:
// definitions and hovers on files it opens. Language-specific setup (which server, how it's installed) lives elsewhere.
import { pathToFileURL, fileURLToPath } from "node:url";

export interface LspPosition { line: number; character: number } // 0-based, character in UTF-16 units
export interface LspRange { start: LspPosition; end: LspPosition }
/** Where a name is declared: the declaration's whole range (span) and its name (at). */
export interface LspTarget { path: string; span: LspRange; at: LspRange }

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: Timer };
const spawn = (cmd: string[], cwd: string, env: Record<string, string | undefined>) => Bun.spawn(cmd, { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
const enc = new TextEncoder(), dec = new TextDecoder();

export class LspClient {
  private proc: ReturnType<typeof spawn>;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private open = new Map<string, number>(); // uri → version, for files sent with didOpen
  private stderr: string[] = [];
  private exitFns: Array<(why: string) => void> = [];
  private stopping = false;
  exited = false;

  private constructor(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
    const proc = (this.proc = spawn(cmd, cwd, env));
    void this.readLoop();
    void (async () => { // the last few lines, for an error message if it dies
      for await (const chunk of proc.stderr) this.stderr = [...this.stderr, ...dec.decode(chunk).split("\n")].slice(-20);
    })();
    void proc.exited.then((code: number) => {
      this.exited = true;
      const why = new Error(`language server exited (${code})${this.stderr.length ? `: ${this.stderr.filter(Boolean).slice(-3).join(" ")}` : ""}`);
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(why); }
      this.pending.clear();
      if (!this.stopping) for (const fn of this.exitFns) fn(why.message);
    });
  }

  /** Starts a server and runs the initialize handshake for one workspace folder. */
  static async start(cmd: string[], root: string, opts: { env?: Record<string, string | undefined>; init?: unknown; timeoutMs?: number } = {}) {
    const c = new LspClient(cmd, root, { ...process.env, ...opts.env });
    const uri = pathToFileURL(root).href;
    await c.request("initialize", {
      processId: process.pid,
      rootUri: uri,
      workspaceFolders: [{ uri, name: "bobby" }],
      capabilities: {
        textDocument: {
          definition: { linkSupport: true },
          hover: { contentFormat: ["markdown", "plaintext"] },
          synchronization: { didSave: false },
        },
        workspace: { configuration: true, workspaceFolders: true },
      },
      initializationOptions: opts.init ?? {},
    }, opts.timeoutMs ?? 60_000);
    c.notify("initialized", {});
    return c;
  }

  request<T = unknown>(method: string, params: unknown, timeoutMs = 30_000): Promise<T> {
    if (this.exited) return Promise.reject(new Error("language server isn't running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`${method} timed out after ${timeoutMs / 1000}s`)); }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }
  notify(method: string, params: unknown) { if (!this.exited) this.send({ jsonrpc: "2.0", method, params }); }

  /** Sends a file's text before asking about it; servers answer only for documents they've been given. */
  openFile(path: string, text: string, languageId: string) {
    const uri = pathToFileURL(path).href;
    if (this.open.has(uri)) return;
    this.open.set(uri, 1);
    this.notify("textDocument/didOpen", { textDocument: { uri, languageId, version: 1, text } });
  }
  closeFile(path: string) {
    const uri = pathToFileURL(path).href;
    if (this.open.delete(uri)) this.notify("textDocument/didClose", { textDocument: { uri } });
  }
  get openCount() { return this.open.size; }

  /** The declaration(s) of the name at a position: Location or LocationLink, as the server prefers. */
  async definition(path: string, pos: LspPosition, timeoutMs?: number): Promise<LspTarget[]> {
    type Loc = { uri: string; range: LspRange };
    type Link = { targetUri: string; targetRange: LspRange; targetSelectionRange: LspRange };
    const r = await this.request<Loc | Array<Loc | Link> | null>("textDocument/definition", { textDocument: { uri: pathToFileURL(path).href }, position: pos }, timeoutMs);
    const list = !r ? [] : Array.isArray(r) ? r : [r];
    return list.map((x) => "targetUri" in x
      ? { path: fileURLToPath(x.targetUri), span: x.targetRange, at: x.targetSelectionRange }
      : { path: fileURLToPath(x.uri), span: x.range, at: x.range });
  }
  /** The hover text at a position (a signature or type, usually a code block), or null. */
  async hover(path: string, pos: LspPosition, timeoutMs?: number): Promise<string | null> {
    type Content = string | { language?: string; value: string; kind?: string };
    const r = await this.request<{ contents: Content | Content[] } | null>("textDocument/hover", { textDocument: { uri: pathToFileURL(path).href }, position: pos }, timeoutMs);
    if (!r) return null;
    const parts = (Array.isArray(r.contents) ? r.contents : [r.contents]).map((c) => typeof c === "string" ? c : c.language ? "```" + c.language + "\n" + c.value + "\n```" : c.value);
    return parts.filter(Boolean).join("\n\n") || null;
  }

  /** Called if the server stops without being asked to. */
  onExit(fn: (why: string) => void) { this.exitFns.push(fn); }

  async stop() {
    if (this.exited) return;
    this.stopping = true;
    await this.request("shutdown", null, 3000).catch(() => {});
    this.notify("exit", null);
    setTimeout(() => { if (!this.exited) this.proc.kill(); }, 1000);
  }

  // ---- framing: "Content-Length: n\r\n\r\n" + n bytes of JSON
  private send(msg: unknown) {
    const body = enc.encode(JSON.stringify(msg));
    this.proc.stdin.write(enc.encode(`Content-Length: ${body.length}\r\n\r\n`));
    this.proc.stdin.write(body);
    this.proc.stdin.flush();
  }
  private async readLoop() {
    let buf = new Uint8Array(0);
    for await (const chunk of this.proc.stdout) {
      const next = new Uint8Array(buf.length + chunk.length);
      next.set(buf); next.set(chunk, buf.length); buf = next;
      for (;;) {
        const head = headerEnd(buf);
        if (head < 0) break;
        const len = Number(/Content-Length:\s*(\d+)/i.exec(dec.decode(buf.subarray(0, head)))?.[1]);
        if (!Number.isFinite(len) || buf.length < head + 4 + len) break;
        const body = dec.decode(buf.subarray(head + 4, head + 4 + len));
        buf = buf.slice(head + 4 + len);
        try { this.receive(JSON.parse(body)); } catch { /* a malformed message: skip it */ }
      }
    }
  }
  private receive(msg: { id?: number; method?: string; params?: { items?: unknown[] }; result?: unknown; error?: { message: string } }) {
    if (msg.method && msg.id != null) { // a request from the server: answer so it doesn't wait on us
      const result = msg.method === "workspace/configuration" ? (msg.params?.items ?? []).map(() => null) : null;
      return this.send({ jsonrpc: "2.0", id: msg.id, result });
    }
    if (msg.id == null) return; // a notification (logs, diagnostics, progress): not used
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    clearTimeout(p.timer);
    if (msg.error) p.reject(new Error(msg.error.message)); else p.resolve(msg.result);
  }
}
/** Index of the blank line (\r\n\r\n) ending a message's headers, or -1. */
function headerEnd(b: Uint8Array) {
  for (let i = 0; i + 3 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  return -1;
}
