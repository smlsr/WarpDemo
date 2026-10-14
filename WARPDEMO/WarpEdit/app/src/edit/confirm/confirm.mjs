import { catColor, catOf, statusText } from "../../../../../WarpView/app/src/core/status.mjs";
import { esc } from "../../../../../WarpView/app/src/core/util.mjs";

export const NOTE_MAX = 500;
const PLACEHOLDER = "Note (optional, saved in the event)";

const idOf = (x) => (x != null && typeof x === "object" ? x.id : x);

function entry(x) {
  if (x != null && typeof x === "object") return { id: x.id, title: x.title, status: x.status == null ? x.from : x.status };
  return { id: x, title: undefined, status: undefined };
}

function group(list) {
  return Array.isArray(list) ? list.filter((x) => idOf(x) != null && idOf(x) !== "").map(entry) : [];
}

export function normalizeDependents(dependents) {
  const d = dependents || {};
  return { blocked: group(d.blocked), inFlight: group(d.inFlight), alreadyMerged: group(d.alreadyMerged) };
}

function chip(phase) {
  const p = phase == null ? "" : String(phase);
  return `<span class="ed-confirm-chip" style="--c:${esc(catColor(catOf(p)))}">${esc(statusText(p))}</span>`;
}

function item(e, tail) {
  const title = e.title ? ` ${esc(e.title)}` : "";
  const status = e.status ? ` ${esc(statusText(e.status))}` : "";
  return `<li><b>${esc(e.id)}</b>${tail == null ? title : `${status || ""} — ${tail}`}</li>`;
}

function dependentsHtml(dependents) {
  const d = normalizeDependents(dependents);
  const parts = [];
  if (d.blocked.length) {
    parts.push(`<p class="ed-confirm-h">Will be blocked</p><ul class="ed-confirm-blocked">${d.blocked.map((e) => item(e)).join("")}</ul>`);
  }
  if (d.inFlight.length || d.alreadyMerged.length) {
    const head = d.inFlight.length && d.alreadyMerged.length ? "In flight on top · already merged on top" : d.inFlight.length ? "In flight on top" : "Already merged on top";
    const rows = d.inFlight.map((e) => item(e, "keeps its status, warned")).concat(d.alreadyMerged.map((e) => item(e, "keeps its status")));
    parts.push(`<p class="ed-confirm-h">${head}</p><ul class="ed-confirm-kept">${rows.join("")}</ul>`);
  }
  if (!parts.length) parts.push(`<p class="ed-confirm-h">No other ticket is affected.</p>`);
  return parts.join("");
}

export function renderConfirm({ ticket, from, to, dependents, note } = {}) {
  const id = esc(idOf(ticket));
  return (
    `<div class="ed-confirm-modal" data-ed="confirm-scrim">` +
    `<div class="ed-confirm-dlg" role="dialog" aria-modal="true" aria-labelledby="ed-confirm-title">` +
    `<h3 id="ed-confirm-title">Reset ${id}</h3>` +
    `<div class="ed-confirm-move">${chip(from)} → ${chip(to)}</div>` +
    dependentsHtml(dependents) +
    `<textarea class="ed-confirm-note" maxlength="${NOTE_MAX}" aria-label="Note" placeholder="${esc(PLACEHOLDER)}">${esc(String(note == null ? "" : note).slice(0, NOTE_MAX))}</textarea>` +
    `<div class="ed-confirm-foot"><button type="button" class="btn" data-ed="confirm-cancel">Cancel</button><button type="button" class="btn primary" data-ed="confirm-ok">Reset</button></div>` +
    `</div></div>`
  );
}

const OPEN = new WeakMap();

export function confirmReset(opts = {}, env = {}) {
  const doc = env.document || (typeof document !== "undefined" ? document : null);
  if (!doc || !doc.body) return Promise.resolve({ ok: false, note: "" });
  const prior = OPEN.get(doc);
  if (prior) prior(false);

  return new Promise((resolve) => {
    const holder = doc.createElement("div");
    holder.innerHTML = renderConfirm(opts);
    const modal = holder.firstElementChild;
    const cancelBtn = modal.querySelector('[data-ed="confirm-cancel"]');
    const okBtn = modal.querySelector('[data-ed="confirm-ok"]');
    const area = modal.querySelector("textarea");
    const before = doc.activeElement;
    let done = false;

    const close = (ok) => {
      if (done) return;
      done = true;
      const note = ok ? area.value.slice(0, NOTE_MAX).trim() : "";
      doc.removeEventListener("keydown", onKey, true);
      modal.remove();
      if (OPEN.get(doc) === close) OPEN.delete(doc);
      if (before && typeof before.focus === "function" && doc.contains(before)) before.focus();
      resolve({ ok: !!ok, note });
    };

    const onKey = (e) => {
      if (!modal.contains(e.target) && e.key !== "Escape" && e.key !== "Tab") {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
        return;
      }
      if (e.key !== "Tab") return;
      const order = [area, cancelBtn, okBtn];
      const at = order.indexOf(doc.activeElement);
      const next = at < 0 ? 0 : (at + (e.shiftKey ? order.length - 1 : 1)) % order.length;
      e.preventDefault();
      order[next].focus();
    };

    area.addEventListener("input", () => {
      if (area.value.length > NOTE_MAX) area.value = area.value.slice(0, NOTE_MAX);
    });
    modal.addEventListener("keydown", (e) => e.stopPropagation());
    cancelBtn.addEventListener("click", () => close(false));
    okBtn.addEventListener("click", () => close(true));
    modal.addEventListener("click", (e) => {
      if (e.target === modal) close(false);
    });
    doc.addEventListener("keydown", onKey, true);
    OPEN.set(doc, close);
    doc.body.appendChild(modal);
    cancelBtn.focus();
  });
}
