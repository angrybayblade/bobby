// View registry. A view is { id, name, hint, mount(el, app) → { update(reason), destroy() } }; see SPEC.md.
import flow from "./flow.js";
import outline from "./outline.js";
import lens from "./lens.js";
import diff from "./diff.js";

export default [flow, outline, lens, diff];
