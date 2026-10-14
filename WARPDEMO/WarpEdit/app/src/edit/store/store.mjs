// Edit store (SPEC §4): `loaded` is never touched; `working` is replaced copy-on-write on every edit.
export const HISTORY_LIMIT = 50;

function withTicket(beam, id, fn) {
  const t = beam.tickets && beam.tickets[id];
  if (!t) return beam;
  return { ...beam, tickets: { ...beam.tickets, [id]: fn(t) } };
}

function statusEvent(change, to, from, note) {
  return { at: change.at, type: "status", from, to, by: change.by || "warpedit", note };
}

export function applyChange(beam, change) {
  let next = withTicket(beam, change.ticket, (t) => ({
    ...t,
    status: change.to,
    events: [...(t.events || []), statusEvent(change, change.to, change.from, change.note)],
    resets: [...(t.resets || []), { from: change.from, to: change.to, at: change.at, note: change.note }],
  }));
  for (const d of change.dependents || []) {
    const note = d.note || `blocked by reset of ${change.ticket}`;
    next = withTicket(next, d.id, (t) => ({
      ...t,
      status: d.to,
      events: [...(t.events || []), statusEvent(change, d.to, d.from, note)],
    }));
  }
  return next;
}

export function createEditStore(beam, options = {}) {
  const apply = options.applyChange || applyChange;
  const loaded = beam;
  let working = beam;
  let past = [];
  let future = [];
  let applied = [];
  let undone = [];
  let savedAt = 0;
  const listeners = new Set();

  function emit(reason, change) {
    for (const fn of [...listeners]) {
      try { fn({ reason, change }); } catch { /* a bad subscriber must not break the store */ }
    }
  }

  const store = {
    get loaded() { return loaded; },
    get working() { return working; },
    get dirty() { return Math.abs(applied.length - savedAt); },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
    changes() { return applied.slice(); },
    nextUndo() { return past.length ? applied[applied.length - 1] : null; },
    nextRedo() { return future.length ? undone[undone.length - 1] : null; },
    apply(change) {
      const prev = working;
      working = apply(working, change);
      past.push({ state: prev, change });
      if (past.length > HISTORY_LIMIT) past.shift();
      applied.push(change);
      future = [];
      undone = [];
      emit("apply", change);
      return working;
    },
    undo() {
      const step = past.pop();
      if (!step) return working;
      future.push({ state: working, change: step.change });
      working = step.state;
      applied.pop();
      undone.push(step.change);
      emit("undo", step.change);
      return working;
    },
    redo() {
      const step = future.pop();
      if (!step) return working;
      past.push({ state: working, change: step.change });
      working = step.state;
      applied.push(step.change);
      undone.pop();
      emit("redo", step.change);
      return working;
    },
    markSaved() {
      savedAt = applied.length;
      emit("saved", null);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
  return store;
}
