// A language server that answers every request with { echo: params, pad }, written back in awkward pieces: split
// mid-header and mid-body, and two messages in one write, to exercise LspClient's reading.
const out = Bun.stdout.writer();
let buf = "";
const enc = new TextEncoder();
let seed = 7;
const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n) + 1;
const pending: Uint8Array[] = [];
function send(msg: unknown) {
  const body = enc.encode(JSON.stringify(msg));
  const all = new Uint8Array([...enc.encode(`Content-Length: ${body.length}\r\n\r\n`), ...body]);
  pending.push(all);
  if (pending.length < 2 && (msg as { id?: number }).id !== 1) return; // hold one back, to write two together
  const joined = new Uint8Array(pending.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of pending.splice(0)) { joined.set(p, at); at += p.length; }
  for (let i = 0; i < joined.length;) { const n = rand(5000); out.write(joined.subarray(i, i + n)); out.flush(); i += n; }
}
for await (const chunk of Bun.stdin.stream()) {
  buf += new TextDecoder().decode(chunk);
  for (;;) {
    const h = buf.indexOf("\r\n\r\n");
    if (h < 0) break;
    const len = Number(/Content-Length: (\d+)/.exec(buf.slice(0, h))![1]);
    if (buf.length < h + 4 + len) break;
    const msg = JSON.parse(buf.slice(h + 4, h + 4 + len));
    buf = buf.slice(h + 4 + len);
    if (msg.id == null) continue;
    if (msg.method === "shutdown") { send({ jsonrpc: "2.0", id: msg.id, result: null }); send({ jsonrpc: "2.0", method: "noop" }); continue; }
    send({ jsonrpc: "2.0", id: msg.id, result: msg.method === "initialize" ? { capabilities: {} } : { echo: msg.params, pad: "é".repeat(msg.params?.size ?? 0) } });
  }
}

export {};
