// What a failed gh or git command means, in one sentence that says what to do. Their own words stay in the log.
// Matched on what they print, since neither gives a code for most of these. Whatever isn't here keeps its own message.

export type GhFailure = "sso" | "scopes" | "signedOut" | "noRepo" | "noPr" | "rateLimit" | "forbidden" | "sshKey" | "offline";

const KINDS: Array<[GhFailure, RegExp]> = [
  ["sso", /SAML|\bSSO\b/],
  ["scopes", /required scopes|requires one of the following scopes|needs? the .* scope/i],
  ["signedOut", /Bad credentials|HTTP 401|gh auth login|Authentication failed|could not read Username|terminal prompts disabled/i],
  ["noRepo", /Could not resolve to a Repository|Repository not found|repository '[^']*' not found/i],
  ["noPr", /Could not resolve to a PullRequest/],
  ["rateLimit", /rate limit/i],
  ["forbidden", /Resource not accessible|Must have admin rights|does not have permission|HTTP 403/i],
  ["sshKey", /Permission denied \(publickey\)|Host key verification failed/i],
  ["offline", /error connecting to|dial tcp|no such host|Could not resolve host|Failed to connect to|TLS handshake|i\/o timeout|Connection timed out/i],
];

export const classify = (text: string): GhFailure | null => KINDS.find(([, re]) => re.test(text))?.[0] ?? null;

/** Failures whose fix depends on who's signed in: worth asking gh, which is slow when GitHub can't be reached. */
export const namesAccount = (kind: GhFailure) => kind === "sso" || kind === "noRepo" || kind === "rateLimit" || kind === "forbidden";

export function explain(kind: GhFailure, text: string, env: { login?: string; envToken?: string } = {}): string {
  const who = env.login ? `the GitHub account ${env.login}` : "your GitHub account";
  const repo = /with the name '([^']+)'/.exec(text)?.[1] ?? /github\.com[/:]([^/\s']+\/[^/\s']+?)(?:\.git)?\/?'?(?:\s|$)/.exec(text)?.[1];
  switch (kind) {
    case "sso": {
      const url = /https:\/\/github\.com\/orgs\/\S+\/sso\S*/.exec(text)?.[0];
      if (url) return `This organization uses single sign-on, and ${who} hasn't authorized it: open ${url}`;
      return env.envToken
        ? `This organization uses single sign-on, and ${env.envToken} isn't authorized for it: authorize that token on GitHub, under Settings › Developer settings.`
        : `This organization uses single sign-on, and ${who} hasn't authorized it: run gh auth refresh, and press Authorize beside the organization on GitHub's page.`;
    }
    case "scopes": {
      const scope = /scopes?: *\[?'?([\w:]+)/.exec(text)?.[1] ?? /the ['"]?([\w:]+)['"]? scope/.exec(text)?.[1];
      return `The sign-in Bobby is using can't do this${scope ? `: it needs the ${scope} permission` : ""}. Run gh auth refresh${scope ? ` -s ${scope}` : ""}.`;
    }
    case "signedOut":
      return env.envToken
        ? `GitHub refused ${env.envToken}: it may have expired. Set a new one, or unset it to use gh's own sign-in.`
        : "GitHub's CLI isn't signed in, or its sign-in has expired: run gh auth login.";
    case "noRepo":
      return `${repo ? `GitHub has no repository ${repo} that ${who} can see` : `GitHub can't find this repository for ${who}`}: check the link. If it's private, sign in with an account that can see it (gh auth login, or gh auth switch).`;
    case "noPr": {
      const n = /number of (\d+)/.exec(text)?.[1];
      return `${n ? `This repository has no pull request #${n}` : "GitHub can't find that pull request"}: check the link or number.`;
    }
    case "rateLimit":
      return `GitHub's rate limit for ${who} has been reached: try again in a few minutes.`;
    case "forbidden":
      return `GitHub won't let ${who} do this here: it needs more access to the repository.`;
    case "sshKey":
      return "GitHub refused your SSH key: check it with ssh -T git@github.com, or let Bobby clone over HTTPS.";
    case "offline":
      return "Can't reach GitHub: check your connection, VPN or proxy, and try again.";
  }
}
