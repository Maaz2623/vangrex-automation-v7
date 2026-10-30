import { delay } from "@livekit/agents";
import { desktop } from "./src/utils/desktop";
import { Terminator } from "./src/utils/terminator";
import { generateText, Output } from "ai";
import { geminiModel } from "./src/models/gemini-llm";
import z from "zod";
import robot from "robotjs";

const task =
  "Create a new request on http://localhost:3000/api/products in thunder client.";

let step = "Inspect the current UI and determine the first action.";

const app = await desktop.getCurrentApplication();
const appName = app.processName();

const MAX_STEPS = 8;

// Prevent repeating the same action unnecessarily.
const executedActions = new Set<string>();

// Track whether the final action has been performed.
let pendingVerification = false;

const actionSchema = z.object({
  status: z.object({
    isTaskComplete: z
      .boolean()
      .describe(
        "True only when the task has been completed and there is evidence of success.",
      ),

    reason: z
      .string()
      .describe(
        "Explain the current state and why the task is complete or incomplete.",
      ),

    nextStep: z
      .string()
      .optional()
      .describe("The next action to perform if the task is incomplete."),
  }),

  element: z
    .object({
      name: z
        .string()
        .describe("The exact element name from the current UI tree."),

      role: z
        .string()
        .describe("The exact element role from the current UI tree."),
    })
    .optional(),

  action: z.object({
    click: z
      .boolean()
      .describe(
        "True to click the target element. If true, typing must be disabled.",
      ),

    type: z.object({
      enabled: z
        .boolean()
        .describe(
          "True to focus the target element and type text without clicking.",
        ),

      text: z
        .string()
        .optional()
        .describe("Text to type when typing is enabled."),
    }),

    completesTask: z
      .boolean()
      .describe("True if this action directly completes the task."),
  }),
});

for (let i = 0; i < MAX_STEPS; i++) {
  await delay(5000);

  console.log(`\n========== STEP ${i + 1} ==========\n`);

  // Fetch the latest UI tree.
  const tree = desktop.getWindowTreeResult(appName, undefined, {
    formatOutput: true,
    treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
    propertyMode: Terminator.PropertyLoadingMode.Complete,
  });

  console.log("Current step:", step);

  const performStep = await generateText({
    model: geminiModel,

    instructions: `
You are a desktop UI automation agent.

Your goal is to complete the user's task using the current UI tree.

## ACTION RULES
1. Inspect the current UI tree before every action.
2. Perform exactly ONE action per iteration.
3. An action must be either CLICK or TYPE, never both.
4. For CLICK: set action.click = true and action.type.enabled = false.
5. For TYPE: set action.click = false and action.type.enabled = true.
6. Never perform an action without identifying its target element.
7. Use the exact element role and name from the current UI tree.
8. Never invent elements or assume an element exists.
9. Do not repeat an action that has already succeeded.

## ELEMENT DISAMBIGUATION
10. Multiple elements can share the same name and role.
11. Never assume the first matching element is the intended target.
12. When multiple matching elements exist, inspect their surrounding UI context.
13. Prefer the element whose parent, neighboring elements, and visible context
    best match the user's request.
14. For extension search results, identify the exact ListItem associated with
    the requested extension and inspect its surrounding context.
15. If necessary, open the matching ListItem's details to verify its identity.
16. Do not click Install until the extension's identity is established.
17. If the correct target cannot be distinguished from the current UI tree,
    request additional UI information instead of guessing.
18. Opening an item's details is a disambiguation step, not permission to
    repeat the original search or restart the workflow.

## ACTION HISTORY AND DUPLICATE PREVENTION
19. Consider the previous step and current UI tree together when deciding
    what to do next.
20. Before proposing an action, determine whether it has already succeeded.
21. If the expected UI transition occurred, advance to the next step.
22. Do not repeat an action merely because its original element disappeared.
23. Do not reopen menus, tabs, or panels that are already open.
24. Do not repeat a search if the expected results are already visible.
25. Do not repeat an installation if the extension already shows Installed,
    Disable, Uninstall, or another reliable installed-state indicator.
26. Do not explore alternative installation locations after a successful
    installation.
27. Retry an action only when the current UI provides evidence that it failed.
28. If an action's outcome is uncertain, inspect the current state before
    deciding whether to retry.
29. If progress cannot be established, explain the uncertainty rather than
    restarting the workflow.

## TASK COMPLETION
30. Set status.isTaskComplete = true only when the requested outcome is
    supported by the current UI.
31. If the task is complete, do not propose any further action.
32. Set action.completesTask = true only when the proposed action directly
    completes the task.
33. After the final action, verify the outcome using the updated UI tree.
34. If verification is inconclusive, do not automatically repeat the final
    action or restart the workflow.

## OUTPUT RULES
35. Return exactly one action per iteration.
36. Keep nextStep focused on the immediate next action.
37. Never restart the entire workflow when only one step remains.
38. If multiple targets remain ambiguous, explain what additional UI
    information is needed rather than guessing.
`,

    prompt: `
USER TASK:
${task}

APPLICATION:
${appName}

CURRENT UI TREE:
${tree.formatted}

PREVIOUS STEP:
${step}

VERIFICATION MODE:
${pendingVerification}

Determine the next appropriate action using the current UI tree.

If typing is needed, return the input element and the text to type.
If clicking is needed, return the target element.
Never enable clicking and typing simultaneously.

If verification mode is true, check whether the task appears complete.
Do not restart the workflow just because a previous menu disappeared.
`,

    output: Output.object({
      schema: actionSchema,
    }),
  });

  const output = performStep.output;

  console.log("AI output:", output);

  // Stop when the model confirms completion.
  if (output.status.isTaskComplete) {
    console.log("\nTask completed:", output.status.reason);
    break;
  }

  step = output.status.nextStep ?? output.status.reason;

  // Avoid restarting the workflow if verification fails.
  if (pendingVerification) {
    console.log(
      "Verification inconclusive. Stopping to avoid repeating actions.",
    );

    console.log("Verification result:", output.status.reason);
    break;
  }

  const shouldClick = output.action.click;
  const shouldType = output.action.type.enabled;

  // Enforce mutually exclusive actions.
  if (shouldClick && shouldType) {
    console.error(
      "Invalid action: clicking and typing cannot happen in the same iteration.",
    );
    break;
  }

  if (!shouldClick && !shouldType) {
    console.log("No action requested. Refreshing the UI...");
    await delay(500);
    continue;
  }

  if (!output.element) {
    console.error("Action requested without a target element.");
    break;
  }

  const { name, role } = output.element;

  // Include the action type in the key.
  // Clicking and typing on the same element are different actions.
  const actionKey = shouldClick
    ? `click:${role}:${name}`.toLowerCase()
    : `type:${role}:${name}:${output.action.type.text ?? ""}`.toLowerCase();

  if (executedActions.has(actionKey)) {
    console.log(`Duplicate action blocked: ${actionKey}`);
    break;
  }

  const selector = `role:${role} && text:${name}`;

  console.log("Target selector:", selector);

  try {
    const element = await app.locator(selector).first(2000);

    if (shouldClick) {
      // CLICK ACTION: click only, never type.
      const bounds = element.bounds();

      if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
        console.log("Invalid element bounds.");
        await delay(500);
        continue;
      }

      const targetX = Math.round(bounds.x + bounds.width / 2);
      const targetY = Math.round(bounds.y + bounds.height / 2);

      console.log(`Clicking ${role}: ${name}`);
      console.log(`Coordinates: ${targetX}, ${targetY}`);

      executedActions.add(actionKey);

      robot.moveMouseSmooth(targetX, targetY);
      robot.mouseClick();
    } else {
      // TYPE ACTION: focus only, never click.
      const text = output.action.type.text;

      if (!text) {
        console.error("Typing requested, but no text was provided.");
        break;
      }

      console.log(`Focusing ${role}: ${name}`);

      // Focus the element through the Terminator element API.
      element.focus();

      await delay(200);

      console.log(`Typing: ${text}`);

      executedActions.add(actionKey);

      element.typeText(text, {
        clearBeforeTyping: true,
      });
    }

    // Allow the UI to settle.
    await delay(800);

    // Switch to verification mode after the final action.
    if (output.action.completesTask) {
      pendingVerification = true;

      step = `Verify that the requested action succeeded. Do not repeat the previous action.`;

      console.log(
        "Action performed. The next iteration will verify the result.",
      );
    }
  } catch (error) {
    console.error("Action failed:", error);

    console.log("Stopping to avoid accidental repeated actions.");
    break;
  }
}

console.log("\nAutomation loop finished.");
