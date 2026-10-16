// View registry. A view is { id, name, hint, available?(graph), mount(el, app) → { update(reason), destroy() } }; see SPEC.md.
import conversation from "./conversation.js";
import flow from "./flow.js";
import outline from "./outline.js";
import lens from "./lens.js";
import diff from "./diff.js";

export default [conversation, flow, outline, lens, diff];
