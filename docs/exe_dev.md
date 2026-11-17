# Bobby on exe.dev

On an [exe.dev](https://exe.dev) VM, Bobby runs in the background and you open it at the machine's own address, `https://<vm>.exe.xyz/`. exe.dev's proxy adds HTTPS and asks for your exe.dev login before anything reaches Bobby, so only you can open it. Bobby's first page then sets up GitHub and Claude Code, signing you in through tabs on your laptop.

## The prompt

Give your agent this prompt, on the VM or on a machine that can `ssh` to it, with your VM's name in place of `<vm>`:

```text
Set up Bobby, a PR reviewer, on my exe.dev VM <vm>, so I can open it at https://<vm>.exe.xyz/.

1. On the VM, install it: curl -fsSL https://raw.githubusercontent.com/angrybayblade/bobby/main/install.sh | bash
   It goes in ~/.local/bin, which isn't on PATH outside a login shell: call it as ~/.local/bin/bobby.
2. On the VM, start it in the background, listening on every interface and answering at the
   machine's address:
   ~/.local/bin/bobby start --host 0.0.0.0 --port 4173 --allow-host <vm>.exe.xyz
3. Point the VM's address at Bobby's port: ssh exe.dev share port <vm> 4173
   That runs from a machine with my exe.dev SSH key, not from the VM. If you can't run it, ask me to.
   Don't make the VM public (share set-public): exe.dev's login keeps Bobby to me.
4. Check it from the VM: curl -s -o /dev/null -w "%{http_code}\n" -H "Host: <vm>.exe.xyz" http://127.0.0.1:4173/
   302 or 200 is right; 403 means the --allow-host name is wrong.
5. Give me https://<vm>.exe.xyz/. Don't sign in to GitHub or Claude for me: Bobby's first page
   walks me through both.

To open a PR in it for me: ~/.local/bin/bobby <github PR URL> --no-open, then give me the same path
at https://<vm>.exe.xyz/. If the VM restarts, run step 2 again.
```

## What it does

- **Installs Bobby** in `~/.local/bin` on the VM.
- **Starts it in the background** (`bobby start`), listening on every interface. `--allow-host <vm>.exe.xyz` lets Bobby answer at the machine's address; without it, Bobby refuses any name but `localhost`.
- **Points the machine's address at Bobby's port** with `ssh exe.dev share port <vm> 4173`. It needs your exe.dev SSH key, so an agent on the VM asks you to run it. The VM stays private.

## When it doesn't work

| What happens | What to do |
|---|---|
| The page says *Bobby only answers its own page (unexpected Host "…")* | Bobby was started with another name. `bobby stop`, then start it again with `--allow-host` set to the name the page shows. |
| The address times out, or exe.dev shows an error page | Bobby isn't running, or the address points at another port. `bobby start` again on the VM, and check `ssh exe.dev share show <vm>`. |
| Pages load but buttons do nothing | `bobby logs` on the VM shows each refused request (`→ 403`) and why. |
| Bobby is gone after the VM restarted | `bobby start` doesn't come back by itself: run step 2 again. |

To update Bobby: `bobby update`, then `bobby stop` and step 2 again. To remove it: `bobby uninstall`.
