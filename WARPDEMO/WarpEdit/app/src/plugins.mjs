// APPEND-ONLY. Each ticket adds one import and one array entry; on conflict keep every line from both sides.
export const plugins = [];
import { historyPlugin } from "./edit/history/history.mjs";
plugins.push(historyPlugin);
import { saveUiPlugin } from "./edit/save-ui/save-ui.mjs";
plugins.push(saveUiPlugin);
import { panelPlugin } from "./edit/drawer-panel/panel.mjs";
plugins.push(panelPlugin);
import { scrubberPlugin } from "./edit/scrubber/scrubber.mjs";
plugins.push(scrubberPlugin);
import { recomputePlugin } from "./edit/recompute/recompute.mjs";
plugins.push(recomputePlugin);
import { createEditStore } from "./edit/store/store.mjs";
import { applyReset } from "./edit/reset/reset.mjs";
import { kindOf } from "./edit/save/save.mjs";
// One edit store per loaded beam or warp-plan export, attached to every plugin that takes one, so a reset in the
// drawer reaches history, recompute and Save. An export lists its tickets in an array; reset and the drawer find
// tickets by id, so the working copy is keyed by id while `loaded` stays the file as read and Save keeps its shape.
export function editStoreFor(data) {
  const list = Array.isArray(data.tickets) ? data.tickets : null;
  const ids = list && list.map((t) => (t && typeof t === "object" && t.id != null ? String(t.id) : null));
  if (!list || ids.includes(null) || new Set(ids).size !== ids.length) return createEditStore(data, { applyChange: applyReset });
  const keyed = { ...data, tickets: Object.fromEntries(list.map((t, i) => [ids[i], t])) };
  return Object.create(createEditStore(keyed, { applyChange: applyReset }), { loaded: { get: () => data } });
}
export function createEditStorePlugin(list = plugins) {
  let edit = null;
  let unsubscribe = null;
  const attachAll = (next) => {
    for (const p of list) if (p && p !== plugin && typeof p.attach === "function") p.attach(next);
  };
  const editable = (docs) => {
    for (const d of Array.isArray(docs) ? docs : []) {
      const k = d && d.data && typeof d.data === "object" ? kindOf(d.data) : null;
      if (k === "beam" || k === "warp-plan") return d.data;
    }
    return null;
  };
  const plugin = {
    id: "edit-store",
    get store() {
      return edit;
    },
    init(app) {
      if (unsubscribe) unsubscribe();
      edit = null;
      unsubscribe = app.store.subscribe((state, reason) => {
        if (reason === "clear") {
          if (edit) attachAll((edit = null));
          return;
        }
        if (reason !== "load" && reason !== "reload") return;
        // A reload must not drop unsaved resets: keep them and lay them over what was read again.
        if (reason === "reload" && edit && edit.dirty > 0) {
          for (const p of list) if (p && p !== plugin && typeof p.recompute === "function") p.recompute();
          return;
        }
        const data = editable(state.docs);
        edit = data ? editStoreFor(data) : null;
        attachAll(edit);
      });
      const destroy = app.destroy;
      app.destroy = () => {
        if (unsubscribe) unsubscribe();
        unsubscribe = null;
        if (typeof destroy === "function") destroy();
      };
    },
  };
  return plugin;
}
plugins.push(createEditStorePlugin());
