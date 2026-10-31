import { delay } from "@livekit/agents";
import { desktop } from "./src/utils/desktop";
import { Terminator } from "./src/utils/terminator";
import { generateText, Output } from "ai";
import { geminiModel } from "./src/models/gemini-llm";
import z from "zod";
import robot from "robotjs";
import { clickWithUiDiff } from "./src/utils/ui-tree-diff";

// ============================================================
// CONFIGURATION
// ============================================================

const task = "Change theme to solarized light.";

const MAX_STEPS = 10;

let step = "Inspect the current UI and determine the first action.";
let pendingVerification = false;

// Initially, retrieve the complete tree.
// After a successful click, replace it with the UI diff.
let formatted = "";
let useUiDiff = false;

const executedActions = new Set<string>();

const app = await desktop.getCurrentApplication();
const appName = app.processName();

// ============================================================
// TOKEN USAGE TRACKER
// ============================================================

type TokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
};

const tokenTotals = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  cachedInputTokens: 0,
  reasoningTokens: 0,
};

function getNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function readTokenUsage(usage: unknown): TokenUsage {
  if (!usage || typeof usage !== "object") {
    return {};
  }

  const u = usage as Record<string, unknown>;

  const inputDetails =
    u.inputTokenDetails && typeof u.inputTokenDetails === "object"
      ? (u.inputTokenDetails as Record<string, unknown>)
      : {};

  const outputDetails =
    u.outputTokenDetails && typeof u.outputTokenDetails === "object"
      ? (u.outputTokenDetails as Record<string, unknown>)
      : {};

  const inputTokens = getNumber(u.inputTokens) ?? getNumber(u.promptTokens);

  const outputTokens =
    getNumber(u.outputTokens) ?? getNumber(u.completionTokens);

  const totalTokens =
    getNumber(u.totalTokens) ??
    (inputTokens !== undefined && outputTokens !== undefined
      ? inputTokens + outputTokens
      : undefined);

  const cachedInputTokens =
    getNumber(inputDetails.cacheReadTokens) ??
    getNumber(inputDetails.cachedTokens) ??
    getNumber(u.cachedInputTokens) ??
    getNumber(u.cachedTokens);

  const reasoningTokens =
    getNumber(outputDetails.reasoningTokens) ?? getNumber(u.reasoningTokens);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    cachedInputTokens,
    reasoningTokens,
  };
}

function logTokenUsage(
  stepNumber: number,
  usage: unknown,
  providerMetadata?: unknown,
): void {
  const parsed = readTokenUsage(usage);

  tokenTotals.calls++;

  tokenTotals.inputTokens += parsed.inputTokens ?? 0;
  tokenTotals.outputTokens += parsed.outputTokens ?? 0;

  tokenTotals.totalTokens +=
    parsed.totalTokens ??
    (parsed.inputTokens ?? 0) + (parsed.outputTokens ?? 0);

  tokenTotals.cachedInputTokens += parsed.cachedInputTokens ?? 0;
  tokenTotals.reasoningTokens += parsed.reasoningTokens ?? 0;

  console.log("\n========== TOKEN USAGE ==========");
  console.log("Step:", stepNumber);
  console.log("Input tokens:", parsed.inputTokens ?? "Not reported");
  console.log("Output tokens:", parsed.outputTokens ?? "Not reported");
  console.log("Total tokens:", parsed.totalTokens ?? "Not reported");
  console.log(
    "Cached input tokens:",
    parsed.cachedInputTokens ?? "Not reported",
  );
  console.log("Reasoning tokens:", parsed.reasoningTokens ?? "Not reported");

  console.log("Raw usage:", JSON.stringify(usage ?? null, null, 2));

  if (providerMetadata !== undefined) {
    console.log(
      "Provider metadata:",
      JSON.stringify(providerMetadata, null, 2),
    );
  }

  console.log("\n========== CUMULATIVE TOTALS ==========");
  console.log("AI calls:", tokenTotals.calls);
  console.log("Input tokens:", tokenTotals.inputTokens);
  console.log("Output tokens:", tokenTotals.outputTokens);
  console.log("Total tokens:", tokenTotals.totalTokens);
  console.log("Cached input tokens:", tokenTotals.cachedInputTokens);
  console.log("Reasoning tokens:", tokenTotals.reasoningTokens);
  console.log("=======================================\n");
}

// ============================================================
// ACTION SCHEMA
// ============================================================

const actionSchema = z.object({
  status: z.object({
    isTaskComplete: z
      .boolean()
      .describe(
        "True only when the current UI provides evidence that the task is complete.",
      ),

    reason: z
      .string()
      .describe(
        "Explain the current UI state and the evidence supporting your decision.",
      ),

    nextStep: z
      .string()
      .optional()
      .describe("The immediate next action or verification needed."),
  }),

  element: z
    .object({
      name: z
        .string()
        .describe("The exact element name from the current UI context."),

      role: z
        .string()
        .describe("The exact element role from the current UI context."),
    })
    .optional(),

  action: z.object({
    click: z.boolean().describe("True to click the target element."),

    type: z.object({
      enabled: z.boolean().describe("True to focus the target and type text."),

      text: z
        .string()
        .optional()
        .describe("The text to type when typing is enabled."),
    }),

    completesTask: z
      .boolean()
      .describe(
        "True only if performing this action should achieve the requested outcome directly.",
      ),
  }),
});

// ============================================================
// HELPERS
// ============================================================

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function getActionKey(
  click: boolean,
  role: string,
  name: string,
  text?: string,
): string {
  return click
    ? `click:${normalize(role)}:${normalize(name)}`
    : `type:${normalize(role)}:${normalize(name)}:${text ?? ""}`;
}

/**
 * Retrieves the complete UI tree and replaces the current context.
 */
async function refreshFullTree(): Promise<void> {
  const tree = await desktop.getWindowTreeResult(appName, undefined, {
    formatOutput: true,
    treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
    propertyMode: Terminator.PropertyLoadingMode.Complete,
  });

  formatted = tree.formatted as string;
  useUiDiff = false;

  console.log("\n========== FULL UI TREE ==========\n");
  console.log(formatted);
}

/**
 * Replaces the complete tree with the latest UI diff.
 *
 * If no usable diff is available, the next iteration will
 * retrieve a fresh complete UI tree.
 */
function replaceTreeWithDiff(
  uiDiff: string | undefined,
  hasChanges: boolean | undefined,
): void {
  if (hasChanges && uiDiff?.trim()) {
    formatted = uiDiff;
    useUiDiff = true;

    console.log("\n========== UI DIFF REPLACED THE TREE ==========\n");
    console.log(formatted);
    console.log("\nNext AI call will receive ONLY this UI diff.");
  } else {
    formatted = "";
    useUiDiff = false;

    console.log(
      "\nNo usable UI diff was returned. The next iteration will retrieve the complete tree.",
    );
  }
}

// ============================================================
// AUTOMATION LOOP
// ============================================================

for (let i = 0; i < MAX_STEPS; i++) {
  console.log(`\n========== STEP ${i + 1} ==========\n`);
  console.log("Current step:", step);
  console.log("Verification mode:", pendingVerification);
  console.log("Using UI diff:", useUiDiff);

  // ----------------------------------------------------------
  // RETRIEVE UI CONTEXT
  // ----------------------------------------------------------

  try {
    // IMPORTANT:
    // If formatted already contains a UI diff, do not overwrite it.
    // Otherwise, retrieve the complete tree.
    if (!useUiDiff || !formatted.trim()) {
      await refreshFullTree();
    } else {
      console.log("\n========== CURRENT UI DIFF ==========\n");
      console.log(formatted);
    }
  } catch (error) {
    console.error("Failed to retrieve the UI tree:", error);
    break;
  }

  await delay(300);

  // ----------------------------------------------------------
  // AI CALL
  // ----------------------------------------------------------

  let performStep;

  try {
    performStep = await generateText({
      model: geminiModel,

      instructions: `
You are a careful desktop UI automation agent.

Your task is to complete the user's request using the supplied UI context.

IMPORTANT UI CONTEXT RULES
1. The supplied UI context may be either a complete UI tree or a UI diff.
2. If it is a complete tree, inspect it normally.
3. If it is a UI diff, treat it as changes from the previous UI state.
4. Do not assume the diff contains every element in the application.
5. Use only elements supported by the supplied context.
6. If the diff does not contain enough information to choose a valid target,
   request a fresh complete UI tree instead of guessing.
7. Return at most one action per iteration.
8. Never invent an element name or role.
9. Never click and type in the same iteration.
10. Never repeat a successfully executed action unnecessarily.

VS CODE THEME WORKFLOW
For changing the theme to Solarized Light:

1. If the Manage menu is closed, click Manage.
2. If Manage is open, inspect its available menu items.
3. If Themes is present, click Themes.
4. Inspect the resulting submenu.
5. If Color Theme is present, click Color Theme.
6. Inspect the resulting theme picker.
7. Select Solarized Light only if that exact option is visible.
8. If the picker contains a search input, focus it and type
   Solarized Light as a separate action.
9. Inspect the resulting search results before selecting an option.
10. Do not assume Solarized Light is installed or available.
11. If the available context is insufficient, request a full UI inspection.

ACTION HISTORY
12. Consider the previous step and the executed action history.
13. Advance the workflow when the UI indicates that an action succeeded.
14. Do not reopen menus unnecessarily.
15. Do not repeat an action just because its element disappeared.
16. A proposed action has not necessarily executed.
17. If the UI state is ambiguous, request a full UI inspection.

VERIFICATION
18. In verification mode, do not perform any actions.
19. Confirm completion only when the supplied UI provides reliable evidence.
20. If the supplied context is only a diff and does not establish the active
    theme, request a fresh full UI inspection.
21. Never repeat the final action merely because verification is inconclusive.

OUTPUT
22. Return one proposed action or no action.
23. Set isTaskComplete true only when completion is supported by evidence.
24. Set completesTask true only when the proposed action should directly
    achieve the requested outcome.
25. If no valid target can be established, explain what must be inspected.
`,

      prompt: `
USER TASK:
${task}

APPLICATION:
${appName}

UI CONTEXT TYPE:
${useUiDiff ? "UI DIFF ONLY" : "COMPLETE UI TREE"}

CURRENT UI CONTEXT:
${formatted}

PREVIOUS STEP:
${step}

VERIFICATION MODE:
${pendingVerification}

PREVIOUSLY EXECUTED ACTIONS:
${JSON.stringify([...executedActions], null, 2)}

Decide the next appropriate action using the supplied UI context.

If the context is a UI diff, do not assume it represents the entire
application. If it does not contain enough information to identify a valid
target, request a fresh complete UI inspection.

If verification mode is true, do not perform another action.
Determine whether the requested outcome is supported by the UI.
`,

      output: Output.object({
        schema: actionSchema,
      }),
    });
  } catch (error) {
    console.error("AI generation failed:", error);
    break;
  }

  // ----------------------------------------------------------
  // TOKEN USAGE
  // ----------------------------------------------------------

  logTokenUsage(i + 1, performStep.usage, performStep.providerMetadata);

  const output = performStep.output;

  console.log("\nAI OUTPUT:\n", output);

  // ----------------------------------------------------------
  // VERIFICATION
  // ----------------------------------------------------------

  if (pendingVerification) {
    if (output.status.isTaskComplete) {
      console.log("\nTASK VERIFIED:", output.status.reason);
    } else {
      console.log("\nVERIFICATION INCONCLUSIVE:", output.status.reason);
    }

    break;
  }

  // Do not trust a completion claim before verification.
  if (output.status.isTaskComplete) {
    console.log(
      "\nAI reported completion before verification:",
      output.status.reason,
    );

    pendingVerification = true;

    step = "Inspect the complete UI tree and verify the requested outcome.";

    // Verification needs a complete tree, not just a diff.
    formatted = "";
    useUiDiff = false;

    continue;
  }

  // ----------------------------------------------------------
  // VALIDATE ACTION
  // ----------------------------------------------------------

  const shouldClick = output.action.click;
  const shouldType = output.action.type.enabled;

  if (shouldClick && shouldType) {
    console.error("Invalid action: click and type cannot both be enabled.");
    break;
  }

  if (!shouldClick && !shouldType) {
    console.log("No action proposed.");
    console.log("Reason:", output.status.reason);

    step = output.status.nextStep ?? output.status.reason;

    // The AI may need elements that were not present in the diff.
    // Retrieve the complete tree on the next iteration.
    formatted = "";
    useUiDiff = false;

    await delay(500);
    continue;
  }

  if (!output.element) {
    console.error("The proposed action has no target element.");

    formatted = "";
    useUiDiff = false;

    continue;
  }

  const { name, role } = output.element;
  const text = output.action.type.text;

  const actionKey = getActionKey(shouldClick, role, name, text);

  if (executedActions.has(actionKey)) {
    console.log("Duplicate action blocked:", actionKey);

    step = `Inspect the complete UI tree after the previous action involving "${name}".`;

    formatted = "";
    useUiDiff = false;

    await delay(500);
    continue;
  }

  console.log("Proposed target:", { role, name });
  console.log("Proposed action:", shouldClick ? "CLICK" : "TYPE");

  // ----------------------------------------------------------
  // EXECUTE ACTION
  // ----------------------------------------------------------

  try {
    const selector = `role:${role} && text:${name}`;

    let element;

    try {
      element = await app.locator(selector).first(2000);
    } catch (error) {
      console.warn("Target not found:", {
        role,
        name,
        error,
      });

      step =
        `The element "${name}" was not found. ` +
        "Inspect the complete, refreshed UI tree and determine the next action.";

      formatted = "";
      useUiDiff = false;

      await delay(500);
      continue;
    }

    // --------------------------------------------------------
    // CLICK
    // --------------------------------------------------------

    if (shouldClick) {
      const bounds = element.bounds();

      if (
        !bounds ||
        !Number.isFinite(bounds.x) ||
        !Number.isFinite(bounds.y) ||
        bounds.width <= 0 ||
        bounds.height <= 0
      ) {
        console.error("Invalid target bounds:", bounds);

        step = `Inspect the complete UI tree because "${name}" has invalid bounds.`;

        formatted = "";
        useUiDiff = false;

        await delay(500);
        continue;
      }

      const targetX = Math.round(bounds.x + bounds.width / 2);

      const targetY = Math.round(bounds.y + bounds.height / 2);

      console.log(`Clicking ${role}: ${name}`);
      console.log(`Coordinates: ${targetX}, ${targetY}`);

      robot.moveMouseSmooth(targetX, targetY);

      // This helper performs the click and returns its UI diff.
      const result = await clickWithUiDiff(
        element.role(),
        element.name() as string,
      );

      executedActions.add(actionKey);

      console.log("Click result:", {
        hasChanges: result.hasChanges,
      });

      // ------------------------------------------------------
      // CRITICAL CHANGE:
      // Replace the entire tree with ONLY the UI diff.
      // ------------------------------------------------------

      replaceTreeWithDiff(result.uiDiff, result.hasChanges);

      // ------------------------------------------------------
      // FINAL ACTION: VERIFY USING A COMPLETE TREE
      // ------------------------------------------------------

      if (output.action.completesTask) {
        pendingVerification = true;

        step =
          "Inspect the complete UI tree and verify that Solarized Light is active.";

        // Do not rely on a partial diff for final verification.
        formatted = "";
        useUiDiff = false;

        console.log(
          "Action executed. The next iteration will retrieve the complete tree for verification.",
        );
      } else {
        step = output.status.nextStep ?? output.status.reason;
      }
    }

    // --------------------------------------------------------
    // TYPE
    // --------------------------------------------------------
    else {
      if (!text) {
        console.error("Typing was requested without any text.");
        break;
      }

      console.log(`Focusing ${role}: ${name}`);

      await element.focus();

      await delay(200);

      console.log("Typing:", text);

      await element.typeText(text, {
        clearBeforeTyping: true,
      });

      executedActions.add(actionKey);

      // Typing does not return a UI diff through this helper.
      // Retrieve a complete tree after typing.
      formatted = "";
      useUiDiff = false;

      step =
        output.status.nextStep ?? `Inspect the UI after typing into "${name}".`;

      if (output.action.completesTask) {
        pendingVerification = true;

        step =
          "Inspect the complete UI tree and verify that Solarized Light is active.";
      }
    }

    await delay(800);
  } catch (error) {
    console.error("Action execution failed:", error);

    console.log("Stopping because the action outcome may be uncertain.");

    break;
  }
}

// ============================================================
// FINAL TOKEN SUMMARY
// ============================================================

console.log("\n========================================");
console.log("          FINAL TOKEN SUMMARY");
console.log("========================================");

console.log("Total AI calls:", tokenTotals.calls);
console.log("Total input tokens:", tokenTotals.inputTokens);
console.log("Total output tokens:", tokenTotals.outputTokens);
console.log("Total tokens:", tokenTotals.totalTokens);
console.log("Cached input tokens:", tokenTotals.cachedInputTokens);
console.log("Reasoning tokens:", tokenTotals.reasoningTokens);

console.log("========================================");
console.log("\nAutomation loop finished.");
