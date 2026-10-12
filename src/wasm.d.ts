// Files imported `with { type: "file" }` (tree-sitter's WebAssembly) resolve to a path: on disk when run from source,
// inside the binary when compiled.
declare module "*.wasm" {
  const path: string;
  export default path;
}
