import { delay } from "./src/utils/delay";
import { desktop } from "./src/utils/desktop";
import { Terminator } from "./src/utils/terminator";
await delay(2000);

const tree = desktop.getWindowTreeResult("Start", undefined, {
  formatOutput: true,
  propertyMode: Terminator.PropertyLoadingMode.Complete,
  treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
});

console.log(tree.formatted);
