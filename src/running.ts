// The Bobby app already running on this machine, found by its lock (state.ts), and the browser to show it in.
import { holder } from "./state.ts";

/** The Bobby app already running, by its lock, if it answers. */
export async function runningApp(): Promise<string | null> {
  const other = holder();
  if (!other) return null;
  const url = `http://127.0.0.1:${other.port}`;
  return (await fetch(`${url}/api/avatar?u=`, { signal: AbortSignal.timeout(1500) }).then((r) => r.status === 400, () => false)) ? url : null;
}

export function openCommand(url: string) {
  if (process.platform === "darwin") return ["open", url];
  if (process.platform === "win32") return ["cmd", "/c", "start", "", url];
  return ["xdg-open", url];
}
