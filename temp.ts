process.env.TERMINATOR_ACTION_OVERLAY = "0";

import { generateText, Output } from "ai";
import { desktop } from "./src/utils/desktop";
import { Terminator } from "./src/utils/terminator";
import { clickWithUiDiff } from "./src/utils/ui-tree-diff";
import { geminiModel } from "./src/models/gemini-llm";
import z from "zod";
import { delay } from "./src/utils/delay";

const task = `change theme to solarized light`;

await delay(3000);

let app = await desktop.getCurrentApplication();
let appName = app.processName();

function getFullTree(processName: string): string {
  const { formatted } = desktop.getWindowTreeResult(processName, undefined, {
    formatOutput: true,
    treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
    propertyMode: Terminator.PropertyLoadingMode.Complete,
  });

  return formatted as string;
}

let formatted = getFullTree(appName);

for (let i = 0; i < 8; i++) {
  const result = await generateText({
    model: geminiModel,

    instructions: `
You are a desktop UI automation agent.

Select exactly one element from the provided UI tree to perform the next action.

Rules:
1. Select an element that exists in the provided UI tree.
2. Return its exact role and exact name as displayed in the tree.
3. ListItem, TreeItem, Text, Group, and other non-Button elements may be clickable.
4. Choose an element relevant to the user's task.
5. Choose only one action per iteration.
6. Do not assume a click succeeded.
7. The next iteration must use the latest UI state.
`,

    prompt: `
Task: ${task}

Current application: ${appName}

UI Tree:
${formatted}
`,

    output: Output.object({
      schema: z.object({
        appName: z.string(),
        elementName: z.string(),
        elementRole: z.string(),
        actionType: z.object({
          click: z.boolean().optional(),
        }),
      }),
    }),
  });

  const output = result.output;

  console.log("Selected:", output);
  console.log("Input tokens:", result.usage.inputTokens);

  const clicked = await clickWithUiDiff(output.elementRole, output.elementName);

  console.log("Action result:", clicked);

  // Allow the UI to react to the action.
  await delay(500);

  // Detect the application that is active after the action.
  const currentApp = await desktop.getCurrentApplication();
  const currentAppName = currentApp.processName();

  if (currentAppName !== appName) {
    // Application changed: fetch the complete tree.
    console.log(`Application changed: ${appName} -> ${currentAppName}`);

    app = currentApp;
    appName = currentAppName;
    formatted = getFullTree(appName);
  } else if (clicked.hasChanges && clicked.uiDiff) {
    // Same application: use the UI diff when available.
    formatted = clicked.uiDiff;
  } else {
    // No usable diff: fetch the complete tree for a reliable state.
    formatted = getFullTree(appName);
  }
}
