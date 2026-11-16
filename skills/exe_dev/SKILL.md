---
name: exe-dev
description: Set up Bobby, the focus-first PR reviewer, on an exe.dev VM and open it from the user's laptop browser through exe.dev's HTTPS proxy. Use when the user asks to install, run, host or set up Bobby on exe.dev (or a *.exe.xyz machine), or to reach a Bobby running there.
---

# Bobby on an exe.dev VM

Bobby is a PR reviewer: one app serving its review UI on a TCP port (4173). On an exe.dev VM, it runs as a systemd user service, and the user opens it at `https://<vm>.exe.xyz:4173/` from their laptop. exe.dev's proxy adds TLS and asks for the user's exe.dev login first. The user then sets up GitHub and Claude Code from Bobby's own first-launch page, signing in through tabs on their laptop. Nothing about their accounts goes through you.

**Bobby has no login of its own.** Anyone who can open its page can read the code under review and post on GitHub as the user. exe.dev's proxy is that login, so the VM's proxy must stay **private**. Never run `share set-public` for a VM running Bobby, and never `share add-link`.

## What you need

- The VM's name: `<vm>` below, as in `<vm>.exe.xyz`. If the user has no VM yet, ask before making one: it's their account. Make it with `ssh exe.dev new --name <vm>`.
- SSH to it: `ssh <vm>.exe.xyz`, or, if that name doesn't resolve, `ssh vm+<vm>@vm.exe.xyz`. Below, `ssh <vm>.exe.xyz '…'` runs a command there.

The default image (exeuntu, Ubuntu 24.04) logs in as `exedev`, with passwordless sudo, systemd, and lingering on, so user services keep running after you log out. It already has `git` and GitHub's CLI `gh`, but no Node and no Claude Code: Bobby installs Claude Code from its page. `~/.local/bin` is on PATH only in interactive shells (`.bashrc`), so call Bobby by its full path in `ssh … '…'` commands.

## Set it up

**1. Install Bobby on the VM.**

```sh
ssh <vm>.exe.xyz 'curl -fsSL https://raw.githubusercontent.com/angrybayblade/bobby/main/install.sh | bash'
```

This puts the binary at `~/.local/bin/bobby`. Check it with `ssh <vm>.exe.xyz '~/.local/bin/bobby --version'`.

**2. Run it as a service**, listening on every interface so the proxy reaches it. `--allow-host` names the address the browser uses. Without a port it allows any port.

```sh
ssh <vm>.exe.xyz 'bash -s' <<'EOF'
set -e
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/bobby.service <<UNIT
[Unit]
Description=Bobby PR reviewer
After=network-online.target

[Service]
ExecStart=%h/.local/bin/bobby home --no-open --port 4173 --host 0.0.0.0 --allow-host $(hostname).exe.xyz
Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
Restart=on-failure

[Install]
WantedBy=default.target
UNIT
export XDG_RUNTIME_DIR=/run/user/$(id -u)
systemctl --user daemon-reload
systemctl --user enable --now bobby
systemctl --user --no-pager status bobby | head -5
EOF
```

`$(hostname)` is expanded on the VM, where it's the VM's name. If `hostname` there isn't `<vm>`, edit the unit and write `--allow-host <vm>.exe.xyz` yourself. Bobby prints a warning at start about listening on `0.0.0.0`. That's expected here, since the proxy is what keeps it private.

**3. Check it answers at that name**, from the VM itself:

```sh
ssh <vm>.exe.xyz 'curl -s -o /dev/null -w "%{http_code}\n" -H "Host: $(hostname).exe.xyz:4173" http://127.0.0.1:4173/'
```

`302` (to the first-launch setup page) or `200` is right. A `403` means the `--allow-host` name is wrong.

**4. Make sure the proxy is private.**

```sh
ssh exe.dev share show <vm>
```

It should not be public. Port 4173 is in the range exe.dev's proxy forwards (3000–9999), at `https://<vm>.exe.xyz:4173/`. Ports other than the main one only open for users with access to the VM, so you don't need to change anything.

**5. Give the user the link:** `https://<vm>.exe.xyz:4173/`. They sign in to exe.dev, then Bobby's **Welcome to Bobby** page sets up:

- **GitHub:** `gh` is already installed, so it goes straight to **Get a sign-in code**. They enter the code on github.com in a new tab, and Bobby notices.
- **Claude Code:** **Install Claude Code**, then **Get a sign-in link**. They sign in in a new tab and paste the code back. This step is optional; **Skip for now** leaves out Claude's tree, questions, reviews and the Map.

Don't run `gh auth login` or `claude auth login` yourself: both need the user, and the page walks them through it.

**6. Check that changes save.** Once the user has the page open and has pressed a button on it, look for refused requests:

```sh
ssh <vm>.exe.xyz '~/.local/bin/bobby logs 40' | grep -E "→ 403|unexpected Host|foreign Origin" || echo "no refusals"
```

Any refusal means the proxy sends Bobby a different Host than the browser's address. Fix it with **When it doesn't work** below.

## Open a PR in it

The user can paste a PR link into the search box on the home page. To open one for them, hand it to the running Bobby:

```sh
ssh <vm>.exe.xyz '~/.local/bin/bobby https://github.com/acme/payments/pull/482 --no-open'
```

It prints `http://127.0.0.1:4173/r/acme/payments/482`. Give the user the same path on the proxy's address, `https://<vm>.exe.xyz:4173/r/acme/payments/482`. Bobby clones the repo into `~/.bobby/repos` the first time; the page shows the progress. Turn `owner/repo#123` into `https://github.com/owner/repo/pull/123` first, because the CLI takes a URL.

## When it doesn't work

| What happens | Why, and what to do |
|---|---|
| The page says *Bobby only answers its own page (unexpected Host "…")* | The proxy sends a different name. Put the name it shows into `--allow-host` in `~/.config/systemd/user/bobby.service`, then `systemctl --user daemon-reload && systemctl --user restart bobby` (with `XDG_RUNTIME_DIR` set as in step 2). |
| Pages load, but buttons do nothing; `bobby logs` shows `403` on POSTs, or *foreign Origin* | Bobby accepts a change only from a page whose address matches the Host it receives, and the proxy changes one of them on the extra port. Serve Bobby at the VM's main address instead: `ssh exe.dev share port <vm> 4173`, which keeps it private. Then open `https://<vm>.exe.xyz/` (no port). |
| The link times out, or exe.dev shows an error page | Bobby isn't running or isn't listening on `0.0.0.0`. Check with `systemctl --user status bobby` and `~/.local/bin/bobby logs` on the VM. `ss -ltnp \| grep 4173` should show `0.0.0.0:4173`. |
| `systemctl --user` says *Failed to connect to bus* | `XDG_RUNTIME_DIR` isn't set in a non-interactive SSH command: `export XDG_RUNTIME_DIR=/run/user/$(id -u)` first. |
| A PR won't clone | Bobby clones over HTTPS with `gh`'s sign-in, so GitHub's step must be done. It asks before trying SSH; the user's SSH keys aren't on the VM anyway. |

**Another way, if the user would rather not use the proxy:** forward the port over SSH. Then run Bobby without `--host` or `--allow-host`, so it listens only on the VM's loopback:

```sh
ssh -L 4173:localhost:4173 <vm>.exe.xyz     # open http://localhost:4173 on the laptop
```

This only works if exe.dev's SSH allows port forwarding. If the forward fails, use the proxy as above.

## Keeping it up

- **Update:** `ssh <vm>.exe.xyz '~/.local/bin/bobby update && XDG_RUNTIME_DIR=/run/user/$(id -u) systemctl --user restart bobby'`. A running Bobby keeps the old version until it restarts.
- **Disk:** `ssh <vm>.exe.xyz '~/.local/bin/bobby clean --stale'` lists what's kept for merged, closed or month-old reviews, including clones no review uses, and asks first. It refuses while Bobby is running, so stop the service around it: `systemctl --user stop bobby`, then `start` it again after.
- **Remove:** `systemctl --user disable --now bobby && rm ~/.config/systemd/user/bobby.service`, then `~/.local/bin/bobby uninstall`. It asks first, and leaves `gh` and Claude Code alone.

Bobby keeps everything under `~/.bobby` on the VM: clones, review progress and drafts. Deleting the VM deletes all of it, including drafts the user hasn't posted.
