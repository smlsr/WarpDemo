// APPEND-ONLY. Each ticket adds one import and one array entry; on conflict keep every line from both sides.
export const plugins = [];
import { historyPlugin } from "./edit/history/history.mjs";
plugins.push(historyPlugin);
import { saveUiPlugin } from "./edit/save-ui/save-ui.mjs";
plugins.push(saveUiPlugin);
import { panelPlugin } from "./edit/drawer-panel/panel.mjs";
plugins.push(panelPlugin);
