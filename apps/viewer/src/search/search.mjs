// Ticket search (WV-08): filter the ticket table by id, summary, and locks.
//
// Pure functions over the parse model's ticket list (WV-03). Nothing here
// touches the DOM or the disk. The query is split on whitespace; a ticket
// matches when every word appears (case-insensitive substring) in its id,
// its summary, or any of its lock paths. An empty or blank query matches all.

const norm = (v) => String(v ?? '').toLowerCase();

// Words of a query, lower-cased. Blank input gives [].
export function queryTerms(query) {
  return norm(query).split(/\s+/).filter(Boolean);
}

// The text a ticket is searched on: id, summary, then each lock path.
export function searchFields(ticket) {
  return [ticket.id, ticket.summary, ...(Array.isArray(ticket.locks) ? ticket.locks : [])].map(norm);
}

export function matchTicket(ticket, query) {
  const terms = queryTerms(query);
  if (!terms.length) return true;
  const fields = searchFields(ticket);
  return terms.every((term) => fields.some((f) => f.includes(term)));
}

// Matching tickets, in the order given. An empty query returns every ticket.
export function filterTickets(tickets, query) {
  const list = Array.isArray(tickets) ? tickets : [];
  return queryTerms(query).length ? list.filter((t) => matchTicket(t, query)) : [...list];
}

// "3 of 16 tickets" style count for the search box.
export function countLabel(shown, total) {
  return shown === total ? `${total} tickets` : `${shown} of ${total} tickets`;
}

// Controller. `els` is { input, table, count } (objects with value / innerHTML /
// textContent). `renderRows(tickets)` returns the table markup for a ticket list,
// for example (list) => boardHtml(list, state, opts) from the tracker.
// An input element is optional; call api.setQuery(q) from any event handler.
export function createSearch(tickets, els, { renderRows, query = '' } = {}) {
  let current = String(query ?? '');

  const render = () => {
    const shown = filterTickets(tickets, current);
    if (els.table && typeof renderRows === 'function') {
      els.table.innerHTML = shown.length ? renderRows(shown) : '<p class="note">No tickets match.</p>';
    }
    if (els.count) els.count.textContent = countLabel(shown.length, tickets.length);
    return shown;
  };

  const api = {
    get query() {
      return current;
    },
    filtered: () => filterTickets(tickets, current),
    setQuery(q) {
      current = String(q ?? '');
      if (els.input && els.input.value !== current) els.input.value = current;
      return render();
    },
    clear: () => api.setQuery(''),
    render,
  };

  if (els.input && typeof els.input.addEventListener === 'function') {
    els.input.addEventListener('input', () => api.setQuery(els.input.value));
  }
  render();
  return api;
}
