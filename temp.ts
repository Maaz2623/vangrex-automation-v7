process.env.TERMINATOR_ACTION_OVERLAY = "0";

import { generateText, Output } from "ai";
import { desktop } from "./src/utils/desktop";
import { Terminator } from "./src/utils/terminator";
import { clickWithUiDiff } from "./src/utils/ui-tree-diff";
import { geminiModel } from "./src/models/gemini-llm";
import z from "zod";
import { delay } from "./src/utils/delay";

const task = `Change the site theme to Dark tritanopia`;
await delay(3000);

const app = await desktop.getCurrentApplication();

let { formatted } = desktop.getWindowTreeResult(app.processName(), undefined, {
  formatOutput: true,
  treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
  propertyMode: Terminator.PropertyLoadingMode.Complete,
});

for (let i = 0; i < 4; i++) {
  const result = await generateText({
    model: geminiModel,
    instructions: `You are a desktop UI automation agent.

Select exactly one element from the provided UI tree to perform the next action.

Rules:
1. Select an element that exists in the provided UI tree.
2. Return its exact role and exact name as displayed in the tree. Do not rename, shorten, or invent either value.
3. ListItem, TreeItem, Text, Group, and other non-Button elements may still be clickable. Do not reject an element because of its role.
4. When uninstalling an extension, identify the official Thunder Client extension, not an alternative or similarly named extension.
5. If the extension's list item is visible, click that item first. Do not click a different extension or an unrelated control.
6. If the extension details page is already open, select the Uninstall control instead.
7. Choose only one action per iteration.
8. Do not assume a click succeeded. The next iteration must inspect the updated UI tree before deciding what to do next.`,
    prompt: `Task: ${task}. Ui Tree: ${formatted}`,
    output: Output.object({
      schema: z.object({
        elementName: z.string(),
        elementRole: z.string(),
        actionType: z.object({
          click: z.boolean().optional(),
          //   type: z.string().optional(),
        }),
      }),
    }),
  });

  const output = result.output;

  const clicked = await clickWithUiDiff(output.elementRole, output.elementName);

  if (clicked.hasChanges) {
    formatted = clicked.uiDiff;
  }

  console.log(formatted);

  console.log(result.output, result.usage.inputTokens);
}
