// Save button, validation banner and Copy as commands (SPEC §7.4) in WarpView's #actionsBar, through headerActions.
import { esc } from "../../../../../WarpView/app/src/core/util.mjs";
import { runKey } from "../../../../../WarpView/app/src/store/store.mjs";
import { MESSAGES, asCommands, download, fileName, kindOf, serialize } from "../save/save.mjs";
import { validate } from "../validate/validate.mjs";

export const BLOCKED_TIP = "Fix the errors below to save";
export const DENIED_TOAST = "Could not copy: clipboard access is denied. The commands are in the dialog to copy by hand.";

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const isObj = (v) => v != null && typeof v === "object" && !Array.isArray(v);

function sourceOf(state) {
  return state && Array.isArray(state.docs) ? state.docs : [];
}

// The file the working copy came from: the doc that holds the loaded object, else the first doc of the same kind.
export function loadedName(state, loaded, kind) {
  const docs = sourceOf(state);
  const same = docs.find((d) => d && d.data === loaded) || docs.find((d) => d && isObj(d.data) && kindOf(d.data) === kind);
  return fileName(same && same.path);
}

export function saveInfo(edit, state) {
  const docs = sourceOf(state);
  let kind;
  if (edit) kind = kindOf(edit.loaded);
  else {
    const kinds = docs.map((d) => (d && isObj(d.data) ? kindOf(d.data) : null));
    if (kinds.includes("beam") || kinds.includes("warp-plan") || !docs.length) return null;
    kind = kinds.includes("schedule") ? "schedule" : kinds.includes("status") ? "status" : "unknown";
  }
  const editable = kind === "beam" || kind === "warp-plan";
  if (!editable) {
    return { kind, edit: !!edit, editable, dirty: 0, errors: [], warnings: [], canSave: false, saveTitle: MESSAGES[kind] || MESSAGES.unknown, commands: [], name: null };
  }
  const dirty = edit.dirty;
  const refused = serialize(edit.loaded, edit.working, kind);
  const errors = refused.ok ? [] : refused.errors;
  const warnings = validate(edit.working).warnings;
  const canSave = dirty > 0 && errors.length === 0;
  const saveTitle = errors.length ? BLOCKED_TIP : dirty > 0 ? "" : "No unsaved changes to save";
  return { kind, edit: true, editable, dirty, errors, warnings, canSave, saveTitle, commands: asCommands(edit.changes()), name: loadedName(state, edit.loaded, kind) };
}

export function renderSave(info) {
  if (!info) return "";
  const grow = info.edit ? "" : '<span class="ed-grow"></span>';
  const copy = info.editable ? '<button type="button" class="btn" data-save-ui="copy">Copy as commands</button>' : "";
  const tip = info.saveTitle ? ` title="${esc(info.saveTitle)}"` : "";
  const save = `<button type="button" class="btn primary" data-save-ui="save"${tip}${info.canSave ? "" : " disabled"}>Save</button>`;
  return `${grow}${copy}${save}`;
}

function line(item, warn) {
  const id = item.ticket == null ? "" : String(item.ticket);
  const msg = String(item.message == null ? "" : item.message);
  const rest = id && msg.startsWith(id) ? msg.slice(id.length) : msg ? ` ${msg}` : "";
  const tail = item.code === "cycle" || /[.!?]$/.test(rest) ? "" : ".";
  const btn = id ? `<button type="button" data-save-ui="ticket" data-ticket="${esc(id)}">${esc(id)}</button>` : "";
  return `${warn ? '<span class="w">Warning:</span> ' : ""}${btn}${esc(rest)}${tail}`;
}

export function renderBanner(info) {
  if (!info || !info.errors.length) return "";
  const n = info.errors.length;
  const rows = [...info.errors.map((e) => line(e, false)), ...info.warnings.map((w) => line(w, true))];
  return `<b>Save is blocked — ${esc(plural(n, "error"))}</b><br>${rows.join("<br>")}`;
}

export function renderCommandsDialog(commands) {
  const text = commands.join("\n");
  return (
    '<div class="ed-save-dlg" role="dialog" aria-modal="true" aria-labelledby="ed-save-dlg-title">' +
    `<h3 id="ed-save-dlg-title">Copy these commands</h3>` +
    `<p class="ed-save-hint">The clipboard is not available. Select the text and copy it by hand, then run it from the repo root.</p>` +
    `<textarea class="ed-save-text" readonly rows="${Math.min(Math.max(commands.length, 2), 10)}" spellcheck="false" wrap="off" aria-label="Commands">${esc(text)}</textarea>` +
    '<div class="ed-save-foot"><button type="button" class="btn primary" data-save-ui="close">Close</button></div>' +
    "</div>"
  );
}

export function createSaveUiPlugin({ store = null, now = null } = {}) {
  let edit = null;
  let app = null;
  let unsubscribe = null;
  let unsubscribeApp = null;
  let dialog = null;

  const doc = () => app && app.root && (app.root.ownerDocument || app.root);
  const win = (ctx) => (ctx && ctx.win) || (doc() && doc().defaultView) || null;
  const stateOf = (ctx) => (ctx && ctx.state) || (app && app.store && app.store.state) || null;
  const clock = () => (typeof now === "function" ? now() : now);

  const refresh = () => {
    if (app && typeof app.render === "function") app.render("plugin");
  };

  function listen() {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    if (edit) unsubscribe = edit.subscribe(refresh);
  }

  function attach(next) {
    edit = next || null;
    listen();
    refresh();
  }

  function openTicket(id, ctx) {
    const state = stateOf(ctx);
    const open = (ctx && ctx.openDrawer) || (app && app.openDrawer);
    if (!state || typeof open !== "function") return false;
    for (const run of state.runs || []) {
      if ((run.tickets || []).some((t) => t.id === id)) return open(runKey(run), id);
    }
    return false;
  }

  function syncBanner(ctx) {
    const d = doc();
    if (!d) return;
    const old = d.querySelector('[data-save-ui="banner"]');
    const info = saveInfo(edit, stateOf(ctx));
    const html = renderBanner(info);
    const anchor = d.querySelector(".headline");
    if (!html || !anchor) {
      if (old) old.remove();
      return;
    }
    const el = old || d.createElement("div");
    el.className = "ed-banner";
    el.setAttribute("data-save-ui", "banner");
    el.setAttribute("role", "alert");
    el.innerHTML = html;
    if (!old) anchor.insertAdjacentElement("afterend", el);
    for (const b of el.querySelectorAll('[data-save-ui="ticket"]')) {
      b.addEventListener("click", () => openTicket(b.getAttribute("data-ticket"), ctx));
    }
  }

  function closeDialog() {
    if (!dialog) return;
    const { el, opener } = dialog;
    dialog = null;
    el.remove();
    if (opener && opener.isConnected && typeof opener.focus === "function") opener.focus();
  }

  function showCommands(commands) {
    const d = doc();
    if (!d) return null;
    closeDialog();
    const el = d.createElement("div");
    el.className = "ed-save-modal";
    el.setAttribute("data-save-ui", "dialog");
    el.innerHTML = renderCommandsDialog(commands);
    d.body.appendChild(el);
    dialog = { el, opener: d.activeElement };
    const text = el.querySelector("textarea");
    const close = el.querySelector('[data-save-ui="close"]');
    close.addEventListener("click", closeDialog);
    el.addEventListener("mousedown", (e) => {
      if (e.target === el) closeDialog();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeDialog();
      } else if (e.key === "Tab") {
        const order = [text, close];
        const at = order.indexOf(d.activeElement);
        const next = e.shiftKey ? order[(at <= 0 ? order.length : at) - 1] : order[(at + 1) % order.length];
        e.preventDefault();
        next.focus();
      }
    });
    text.focus();
    text.select();
    return el;
  }

  function save(ctx) {
    if (!edit) return false;
    const toast = (ctx && ctx.toast) || (app && app.toast);
    const say = (msg, err = false) => typeof toast === "function" && toast(msg, err);
    const state = stateOf(ctx);
    const info = saveInfo(edit, state);
    if (!info || !info.canSave) {
      if (info && info.saveTitle) say(info.saveTitle, true);
      return false;
    }
    const out = serialize(edit.loaded, edit.working, info.kind, { now: clock() });
    if (!out.ok) {
      say(out.message, true);
      return false;
    }
    let name;
    try {
      name = download(info.name, out.text, win(ctx));
    } catch (e) {
      say(`Could not save ${info.name}: the download did not start`, true);
      return false;
    }
    const n = edit.dirty;
    edit.markSaved();
    say(`Saved ${name} (${plural(n, "change")})`);
    return true;
  }

  function copy(ctx) {
    if (!edit) return Promise.resolve(false);
    const toast = (ctx && ctx.toast) || (app && app.toast);
    const say = (msg, err = false) => typeof toast === "function" && toast(msg, err);
    const commands = asCommands(edit.changes());
    if (!commands.length) {
      say("No changes to copy");
      return Promise.resolve(false);
    }
    const denied = () => {
      say(DENIED_TOAST, true);
      showCommands(commands);
      return false;
    };
    const w = win(ctx);
    const clip = w && w.navigator && w.navigator.clipboard;
    if (!clip || typeof clip.writeText !== "function") return Promise.resolve(denied());
    let pending;
    try {
      pending = Promise.resolve(clip.writeText(commands.join("\n")));
    } catch {
      return Promise.resolve(denied());
    }
    return pending.then(
      () => {
        say(`Copied ${plural(commands.length, "command")}`);
        return true;
      },
      () => denied(),
    );
  }

  const plugin = {
    id: "save-ui",
    attach,
    get store() {
      return edit;
    },
    pending: null,
    save,
    copy,
    headerActions: [
      {
        id: "save-ui",
        render: (state) => renderSave(saveInfo(edit, (app && app.store && app.store.state) || state)),
        bind(el, ctx) {
          const c = el.querySelector('[data-save-ui="copy"]');
          const s = el.querySelector('[data-save-ui="save"]');
          if (c) c.addEventListener("click", () => (plugin.pending = copy(ctx)));
          if (s) s.addEventListener("click", () => save(ctx));
          syncBanner(ctx);
        },
      },
    ],
    init(a) {
      app = a;
      if (unsubscribeApp) unsubscribeApp();
      unsubscribeApp = a && a.store && typeof a.store.subscribe === "function" ? a.store.subscribe(() => syncBanner()) : null;
      const destroy = a.destroy;
      a.destroy = () => {
        if (unsubscribe) unsubscribe();
        if (unsubscribeApp) unsubscribeApp();
        unsubscribe = null;
        unsubscribeApp = null;
        closeDialog();
        const d = doc();
        const b = d && d.querySelector('[data-save-ui="banner"]');
        if (b) b.remove();
        app = null;
        if (typeof destroy === "function") destroy();
      };
      if (!edit && store) attach(store);
      else listen();
    },
  };
  return plugin;
}

export const saveUiPlugin = createSaveUiPlugin();
