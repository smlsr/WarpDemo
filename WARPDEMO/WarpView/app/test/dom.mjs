import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const SLOT = /(<script id="warp-data" type="application\/json">)[\s\S]*?(<\/script>)/;

export function withData(html, data) {
  const json = JSON.stringify(data === undefined ? null : data).replace(/</g, "\\u003c");
  return html.replace(SLOT, (_, open, close) => open + json + close);
}

export function loadBuilt(file, fixture = null, options = {}) {
  const html = withData(readFileSync(file, "utf8"), fixture);
  return new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: "file:///viewer.html", ...options });
}
