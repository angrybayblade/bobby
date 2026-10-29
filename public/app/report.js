// The page's errors, into Bobby's log (bobby logs), beside the server's: what broke, where, and its stack, so a bug
// report has both halves. Fire and forget; the server keeps a few a minute at most.
export function report(level, message, detail = "") {
  try {
    fetch("/api/log", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ level, message: String(message ?? ""), detail: String(detail ?? ""), where: location.pathname }), keepalive: true }).catch(() => {});
  } catch { /* nowhere to report it */ }
}
/** Sends errors nothing caught: thrown, or a promise rejected with no one waiting on it. */
export function reportErrors() {
  addEventListener("error", (e) => report("error", e.message, e.error?.stack ?? `${e.filename}:${e.lineno}:${e.colno}`));
  addEventListener("unhandledrejection", (e) => report("error", e.reason?.message ?? e.reason, e.reason?.stack ?? ""));
}
