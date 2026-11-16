// The first launch: until GitHub's CLI and Claude Code are each set up (installed and signed in) or skipped, every page
// sends you to the setup page (/welcome), which sends you on to where you were going. Finished once, it stays finished
// (settings.onboarded); a machine with both already set up never sees it.
import { claudeStatus } from "./claude.ts";
import { ghStatus } from "./github.ts";
import { loadSettings, saveSettings } from "./state.ts";

type Ready = { installed: boolean; loggedIn: boolean };
/** Whether a step needs nothing more: set up, or skipped ("never", which Settings and the palette can still undo). */
const settled = (s: Ready, choice: unknown) => (s.installed && s.loggedIn) || choice === "never";

/** Whether onboarding is finished, from the saved settings and how gh and Claude stand. */
export function onboarded(settings: Record<string, unknown>, gh: Ready, claude: Ready): boolean {
  return !!settings.onboarded || (settled(gh, settings.gh) && settled(claude, settings.claude));
}

let done = false; // finished: no more asking gh and Claude on every page
/** Whether the page should go to the setup page first. Finishes it on its own once there's nothing left to set up. */
export async function needsOnboarding(): Promise<boolean> {
  if (done) return false;
  const settings = loadSettings();
  if (settings.onboarded) return !(done = true);
  const [gh, claude] = await Promise.all([ghStatus(), claudeStatus()]);
  if (!onboarded(settings, gh, claude)) return true;
  finishOnboarding();
  return false;
}

/** Marks onboarding finished, for good. */
export function finishOnboarding() {
  done = true;
  const s = loadSettings();
  if (!s.onboarded) saveSettings({ ...s, onboarded: new Date().toISOString() });
}

