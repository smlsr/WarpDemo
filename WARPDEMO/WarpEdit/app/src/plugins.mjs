// APPEND-ONLY. Each ticket adds one import and one array entry; on conflict keep every line from both sides.
export const plugins = [];
import { historyPlugin } from "./edit/history/history.mjs";
plugins.push(historyPlugin);
