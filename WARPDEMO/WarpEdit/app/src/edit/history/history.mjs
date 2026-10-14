// History controls (SPEC §7.3): unsaved chip, Undo and Redo in WarpView's #actionsBar, Ctrl/Cmd+Z keys, beforeunload.
import { esc } from "../../../../../WarpView/app/src/core/util.mjs";

const TYPING = /^(input|select|textarea)$/i;

export function describeChange(change) {
  if (!change) return "";
  return `${change.ticket} ${change.from} → ${change.to}`;
}

export function isTyping(target) {
  return !!target && (TYPING.test(target.tagName || "") || target.isContentEditable === true);
}

export function historyInfo(store) {
  if (!store) return null;
  const undo = store.nextUndo();
  const redo = store.nextRedo();
  const changes = store.changes();
  return {
    dirty: store.dirty,
    canUndo: store.canUndo,
    canRedo: store.canRedo,
    undoLabel: describeChange(undo),
    redoLabel: describeChange(redo),
    last: describeChange(changes[changes.length - 1]),
  };
}

export function renderHistory(info) {
  if (!info) return "";
  const chip = info.dirty > 0 ? `<span class="ed-unsaved" data-history="count">${esc(info.dirty)} unsaved</span>` : "";
  const note =
    info.dirty > 0
      ? info.last
        ? `<span class="ed-note">${esc(info.last)}</span>`
        : ""
      : '<span class="ed-note">No unsaved changes</span>';
  const undoTip = info.canUndo ? ` title="${esc("Undo " + info.undoLabel)}"` : "";
  const redoTip = info.canRedo ? ` title="${esc("Redo " + info.redoLabel)}"` : "";
  return (
    `${chip}${note}<span class="ed-grow"></span>` +
    `<button type="button" class="btn" data-history="undo"${undoTip}${info.canUndo ? "" : " disabled"}>↶ Undo</button>` +
    `<button type="button" class="btn" data-history="redo"${redoTip}${info.canRedo ? "" : " disabled"}>↷ Redo</button>`
  );
}

export function createHistoryPlugin({ store = null } = {}) {
  let edit = null;
  let app = null;
  let unsubscribe = null;
  let unload = null;

  const refresh = () => {
    if (app && typeof app.render === "function") app.render("plugin");
  };

  function attach(next) {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    edit = next || null;
    if (edit) unsubscribe = edit.subscribe(refresh);
    refresh();
  }

  function step(kind, toast) {
    if (!edit) return false;
    const can = kind === "undo" ? edit.canUndo : edit.canRedo;
    if (!can) return false;
    const change = kind === "undo" ? edit.nextUndo() : edit.nextRedo();
    if (kind === "undo") edit.undo();
    else edit.redo();
    if (typeof toast === "function") toast(`${kind === "undo" ? "Undid" : "Redid"} ${describeChange(change)}`);
    return true;
  }

  const keyRun = (kind) => (event, ctx) => {
    if (event && isTyping(event.target)) return;
    step(kind, ctx && ctx.toast);
  };

  const plugin = {
    id: "history",
    attach,
    get store() {
      return edit;
    },
    headerActions: [
      {
        id: "history",
        render: () => renderHistory(historyInfo(edit)),
        bind(el, ctx) {
          for (const kind of ["undo", "redo"]) {
            const b = el.querySelector(`[data-history="${kind}"]`);
            if (b) b.addEventListener("click", () => step(kind, ctx && ctx.toast));
          }
        },
      },
    ],
    keys: [
      { key: "z", ctrl: true, shift: false, run: keyRun("undo") },
      { key: "Z", ctrl: true, shift: true, run: keyRun("redo") },
      { key: "z", ctrl: true, shift: true, run: keyRun("redo") },
    ],
    init(a) {
      app = a;
      const win = a && a.root && (a.root.defaultView || (a.root.ownerDocument && a.root.ownerDocument.defaultView));
      if (win && !unload) {
        unload = (event) => {
          if (!edit || !(edit.dirty > 0)) return undefined;
          event.preventDefault();
          event.returnValue = "";
          return "";
        };
        win.addEventListener("beforeunload", unload);
        const destroy = a.destroy;
        a.destroy = () => {
          win.removeEventListener("beforeunload", unload);
          unload = null;
          if (unsubscribe) unsubscribe();
          unsubscribe = null;
          app = null;
          if (typeof destroy === "function") destroy();
        };
      }
      if (store && !edit) attach(store);
    },
  };
  return plugin;
}

export const historyPlugin = createHistoryPlugin();
