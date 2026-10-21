"""GitHub's Files changed diff, as HTML, from the demo repo's git diff: unified, two number columns, GitHub's light
colours. Rewrites the part of the page between <!-- gh-diff --> and <!-- /gh-diff -->.
usage: github-diff.py <demo repo> <index.html>"""
import html, re, subprocess, sys
repo, page = sys.argv[1:3]
out = subprocess.run(["git", "-C", repo, "diff", "--no-color", "-U3", "main", "retry-idempotency"], capture_output=True, text=True).stdout
KW = r"\b(import|from|export|async|function|const|let|return|await|try|catch|throw|for|if|new|type|interface|of)\b"
def hl(code):
    s = html.escape(code)
    s = re.sub(r"(&quot;[^&]*?&quot;|`[^`]*`)", r'<span class="s">\1</span>', s)
    s = re.sub(r'(?<![\w-])' + KW + r'(?![\w-])(?![^<]*</span>)', r'<span class="k">\1</span>', s)
    s = re.sub(r"\b([a-zA-Z_]\w*)(?=\()(?![^<]*</span>)", r'<span class="f">\1</span>', s)
    s = re.sub(r"(?<![\w#])(\d+(?:\.\d+)?)(?![^<]*</span>)", r'<span class="n">\1</span>', s)
    return s
THREADS = {("src/billing/invoice.ts", 7): '''<div class="th"><div class="tbox">
  <div class="tc"><span class="av" style="--c:#bf8700">LI</span><div><p><b>lina</b> <span>2 hours ago</span></p><p>Do fees belong in this PR? Happy to review them separately.</p></div></div>
  <div class="tf"><span class="reply">Reply…</span><span class="btn">Resolve conversation</span></div></div></div>'''}
files = re.split(r"^diff --git ", out, flags=re.M)[1:]
parts = []
for f in files:
    path = re.search(r" b/(\S+)", f.splitlines()[0]).group(1)
    adds = sum(1 for l in f.splitlines() if l.startswith("+") and not l.startswith("+++"))
    dels = sum(1 for l in f.splitlines() if l.startswith("-") and not l.startswith("---"))
    blocks = "".join(f'<i class="{c}"></i>' for c in (["a"] * round(5 * adds / max(1, adds + dels)) + ["d"] * (5 - round(5 * adds / max(1, adds + dels)))))
    rows = []
    o = n = 0
    for l in f.splitlines():
        if l.startswith("@@"):
            m = re.match(r"@@ -(\d+)(?:,\d+)? \+(\d+)", l); o, n = int(m.group(1)), int(m.group(2))
            rows.append(f'<tr class="hk"><td class="no"></td><td class="no"></td><td><code>{html.escape(l)}</code></td></tr>')
        elif l[:1] in "+- " and not l.startswith(("+++", "---")) and (o or n):
            k = {"+": "a", "-": "d", " ": ""}[l[0]]
            on = "" if k == "a" else o; nn = "" if k == "d" else n
            rows.append(f'<tr class="{k}"><td class="no">{on}</td><td class="no">{nn}</td><td><code><b>{l[0] if k else " "}</b>{hl(l[1:])}</code></td></tr>')
            if k != "a": o += 1
            if k != "d":
                if (path, n) in THREADS: rows.append(f'<tr class="tr"><td colspan="3">{THREADS[(path, n)]}</td></tr>')
                n += 1
    parts.append(f'''<div class="file"><header><span class="chev">⌄</span><span class="ct">{adds + dels}</span><span class="blocks">{blocks}</span><b>{html.escape(path)}</b><span class="cp">⧉</span><em><i>☐</i> Viewed</em><span class="kb">···</span></header><table>{"".join(rows)}</table></div>''')
html_ = "\n".join("              " + l for l in "\n".join(parts).splitlines())
s = open(page).read()
a, b = s.index("<!-- gh-diff -->") + len("<!-- gh-diff -->"), s.index("              <!-- /gh-diff -->")
open(page, "w").write(s[:a] + "\n" + html_ + "\n" + s[b:])
