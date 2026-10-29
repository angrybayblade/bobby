// Bobby's log: what it did and what went wrong, for a bug report you can share. Each line goes to the terminal (info to
// stdout; warnings and errors to stderr) and to ~/.bobby/logs/bobby.log, with its time and level. The page's errors
// come here too (/api/log). `bobby logs` says where the file is and shows its end. Tokens are blanked out on the way in;
// the file is rotated at 5 MB (one old one kept, bobby.1.log).
import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { home } from "./state.ts";

export type Level = "debug" | "info" | "warn" | "error";
const MAX = 5 * 1024 * 1024;
export const logDir = () => join(home(), "logs");
export const logPath = () => join(logDir(), "bobby.log");

// what looks like a credential: GitHub tokens, bearer headers, key=… in a URL or command
const SECRETS = [/\b(gh[opsur]_[A-Za-z0-9]{20,})/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g, /\b(sk-ant-[A-Za-z0-9_-]{10,})/g, /(Bearer\s+)[A-Za-z0-9._-]{12,}/gi, /([?&](?:token|access_token|key|code)=)[^&\s]+/gi, /(\/\/[^/\s:@]+:)[^@\s]+(?=@)/g];
export const redact = (s: string) => SECRETS.reduce((out, re) => out.replace(re, (m, keep) => (typeof keep === "string" && keep !== m ? `${keep}•••` : "•••")), s);

let checked = false, broken = false;
/** Appends one line to the file; a log that can't be written (read-only home, full disk) is given up on quietly. */
export function toFile(level: Level, msg: string, data?: unknown) {
  if (broken) return;
  try {
    if (!checked) {
      checked = true;
      mkdirSync(logDir(), { recursive: true });
      if (existsSync(logPath()) && statSync(logPath()).size > MAX) renameSync(logPath(), join(logDir(), "bobby.1.log"));
    }
    const extra = data === undefined ? "" : ` ${typeof data === "string" ? data : JSON.stringify(data, (_, v) => (v instanceof Error ? { message: v.message, stack: v.stack } : v))}`;
    appendFileSync(logPath(), `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${redact(msg + extra).replace(/\n/g, "\n    ")}\n`);
  } catch { broken = true; }
}

/** Where terminal output goes: stdout, or stderr when stdout carries data (bobby extract, writing a graph to it). */
let quiet = false;
export const stdoutIsData = () => { quiet = true; };
const say = (level: Level, msg: string) => {
  if (level === "debug" && !process.env.BOBBY_DEBUG) return;
  (level === "info" && !quiet ? process.stdout : process.stderr).write(`${msg}\n`);
};
export const debug = (msg: string, data?: unknown) => { say("debug", msg); toFile("debug", msg.trim(), data); };
export const info = (msg: string, data?: unknown) => { say("info", msg); toFile("info", msg.trim(), data); };
export const warn = (msg: string, data?: unknown) => { say("warn", msg); toFile("warn", msg.trim(), data); };
export const error = (msg: string, data?: unknown) => { say("error", msg); toFile("error", msg.trim(), data); };

/** The first line of a run: which Bobby, where, asked to do what. */
export function started(version: string, argv: string[]) {
  toFile("info", `--- bobby ${version} · ${process.platform} ${process.arch} · bun ${Bun.version} · pid ${process.pid} · bobby ${argv.join(" ")}`);
}
