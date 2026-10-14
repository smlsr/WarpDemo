// build.mjs cuts WarpView's own createApp call from the bundled entry, so the app boots once, here, with the plugins.
import { createApp } from "../../../WarpView/app/src/main.mjs";
import { plugins } from "./plugins.mjs";

if (typeof document !== "undefined" && document.getElementById("warp-data")) {
  createApp({ root: document, plugins });
}
