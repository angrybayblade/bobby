# Third-party notices

Bobby's release binaries and package include the software below. Each is used under its own license, reproduced or
linked here.

## Bun runtime

The release binaries are built with `bun build --compile`, so each one contains the Bun runtime.
Bun is MIT-licensed and statically links other projects, among them JavaScriptCore (WebKit), which is under the
LGPL-2.1. Their licenses, and how to obtain the corresponding sources, are listed at
<https://bun.sh/docs/project/licensing>.

## web-tree-sitter

The tree-sitter runtime, as WebAssembly. <https://github.com/tree-sitter/tree-sitter>

```
The MIT License (MIT)

Copyright (c) 2018-2021 Max Brunsfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Tree-sitter grammars

Prebuilt by tree-sitter-wasms (<https://github.com/Gregoor/tree-sitter-wasms>), released under the Unlicense (public
domain). The grammars themselves are each under the MIT License, copyright their authors:

- tree-sitter-typescript (TypeScript and TSX): <https://github.com/tree-sitter/tree-sitter-typescript>
- tree-sitter-javascript: <https://github.com/tree-sitter/tree-sitter-javascript>
- tree-sitter-python: <https://github.com/tree-sitter/tree-sitter-python>
- tree-sitter-go: <https://github.com/tree-sitter/tree-sitter-go>
- tree-sitter-java: <https://github.com/tree-sitter/tree-sitter-java>
- tree-sitter-rust: <https://github.com/tree-sitter/tree-sitter-rust>

The MIT License's terms are as in web-tree-sitter's notice above, with each grammar's own copyright line.

## highlight.js

Syntax highlighting in the review UI (`public/vendor/highlight.min.js`, v11.9.0). <https://github.com/highlightjs/highlight.js>

```
BSD 3-Clause License

Copyright (c) 2006, Ivan Sagalaev.
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the copyright holder nor the names of its
  contributors may be used to endorse or promote products derived from
  this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Language servers (installed separately)

Not shipped with Bobby: when you agree, Bobby installs them from npm into `~/.bobby/servers`, each under its own
license: typescript-language-server (Apache-2.0), TypeScript (Apache-2.0) and pyright (MIT). gopls (BSD-3-Clause) is
one you install yourself.
