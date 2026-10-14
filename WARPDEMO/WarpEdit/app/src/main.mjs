import { createApp } from "../../../WarpView/app/src/main.mjs";
import { plugins } from "./plugins.mjs";

if (typeof document !== "undefined" && document.getElementById("warp-data")) {
  createApp({ root: document, plugins });
}
