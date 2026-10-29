import { delay } from "@livekit/agents";
import { desktop } from "./src/utils/desktop";
import { Terminator } from "./src/utils/terminator";

await delay(3000);

const app = await desktop.getCurrentBrowserWindow();

const tree = desktop.getWindowTreeResult(app.processName(), app.name(), {
  formatOutput: true,
  treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
  propertyMode: Terminator.PropertyLoadingMode.Complete,
});

console.log(tree.formatted);
