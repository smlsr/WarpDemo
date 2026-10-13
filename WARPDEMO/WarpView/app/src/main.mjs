const LOGO =
  '<svg width="54" height="54" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="12" fill="#0E1719"/><path d="M14 12v40M24 12v40M40 12v40M50 12v40" stroke="#43B3AD" stroke-width="3"/><path d="M14 20h36M14 32h36M14 44h36" stroke="#F7FAFA" stroke-width="2.4" opacity=".85"/></svg>';

export function renderEmpty() {
  return `${LOGO}
    <h2>Open a Warp run</h2>
    <p>Open <code>.warp/beam.json</code>, or <code>status.json</code>, or the whole <code>.warp</code> folder. Ticket <code>state.json</code> files are read too. A named run's <code>.warp/runs/&lt;name&gt;/</code> works the same way, and several runs open side by side.</p>
    <p>You can also drop files or a folder anywhere on this page. Nothing is uploaded: the files are read in this browser.</p>
    <div class="row">
      <button class="btn primary" data-act="open-files">Open status files…</button>
      <button class="btn" data-act="open-folder">Open .warp folder…</button>
    </div>`;
}

export function createApp({ root = document, plugins = [] } = {}) {
  const $ = (s) => root.querySelector(s);
  const empty = $("#emptyState");
  const app = $("#app");
  if (empty) {
    empty.innerHTML = renderEmpty();
    empty.classList.remove("hidden");
    empty.hidden = false;
  }
  if (app) {
    app.classList.add("hidden");
    app.hidden = true;
  }
  const meta = $("#meta");
  if (meta) meta.innerHTML = '<span class="chip">No run loaded</span>';
  return { root, plugins, hooks: { drawerSections: [], headerActions: [], swimlaneOverlays: [], keys: [] } };
}

if (typeof document !== "undefined" && document.getElementById("warp-data")) {
  createApp({ root: document });
}
