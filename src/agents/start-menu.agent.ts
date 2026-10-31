import { tool, ToolLoopAgent } from "ai";
import { geminiModel } from "../models/gemini-llm";
import { desktop } from "../utils/desktop";
import { delay } from "../utils/delay";
import { Terminator } from "../utils/terminator";
import z from "zod";
import { scrollElementIntoView } from "../utils/important/scroll-element-into-view";

type StartMenuAction = "open" | "close" | "inspect" | "locate_app";

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const SCREEN_WIDTH = 1920;
const SCREEN_HEIGHT = 1080;

function hasValidBounds(bounds: Bounds): boolean {
  return (
    bounds.width >= 20 &&
    bounds.height >= 20 &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.x + bounds.width <= SCREEN_WIDTH &&
    bounds.y + bounds.height <= SCREEN_HEIGHT
  );
}

async function getStartMenuTree() {
  try {
    return await desktop.getWindowTreeResult("Start", undefined, {
      formatOutput: true,
      treeOutputFormat: Terminator.TreeOutputFormat.CompactYaml,
      propertyMode: Terminator.PropertyLoadingMode.Complete,
    });
  } catch {
    return null;
  }
}

async function getElementBounds(
  selector: string,
  timeout = 1500,
): Promise<Bounds | null> {
  try {
    const element = await desktop.locator(selector).first(timeout);
    return await element.bounds();
  } catch {
    return null;
  }
}

export const startMenuAgent = new ToolLoopAgent({
  model: geminiModel,

  instructions: `
You are Vangrex's Windows Start Menu specialist.

Your job is to interact with the Windows Start menu using the operate tool.

AVAILABLE ACTIONS:

1. open
   Open the Start menu.

2. close
   Close the Start menu.

3. inspect
   Inspect the current Start menu accessibility tree.

4. locate_app
   Locate an application in the Start menu and bring it into view.

RULES:

- Select the appropriate action based on the user's request.
- When locating an application, pass its actual name to locate_app.
- If the Start menu is not available, attempt to open it first.
- Use the UI tree and element bounds to understand the current state.
- An element with bounds near (0, 0), or with tiny dimensions, may be
  present in the accessibility tree but outside the visible area.
- Use scrollElementIntoView when the element has invalid bounds.
- After scrolling, reacquire the element and verify its latest bounds.
- Do not claim an application is visible unless its bounds pass validation.
- Do not launch an application when the user only asks to locate it.
- Never invent UI elements or application names.
- Report failures honestly.
- Keep your response concise.
`,

  tools: {
    operate: tool({
      description: `
Operate the Windows Start menu.

Use:
- open: open the Start menu.
- close: close the Start menu.
- inspect: return the Start menu accessibility tree.
- locate_app: find an application and scroll it into view without launching it.
`,

      inputSchema: z.object({
        action: z
          .enum(["open", "close", "inspect", "locate_app"])
          .describe("The Start menu operation to perform."),

        applicationName: z
          .string()
          .optional()
          .describe(
            "The application's accessible name. Required for locate_app.",
          ),
      }),

      execute: async ({
        action,
        applicationName,
      }): Promise<{
        success: boolean;
        action: StartMenuAction;
        message: string;
        applicationName?: string;
        bounds?: Bounds;
        tree?: string;
        error?: string;
      }> => {
        try {
          let tree = await getStartMenuTree();

          // ============================================
          // OPEN START MENU
          // ============================================

          if (action === "open") {
            if (!tree) {
              await desktop.pressKey("{Win}");
              await delay(600);

              tree = await getStartMenuTree();
            }

            if (!tree) {
              return {
                success: false,
                action,
                message: "Could not verify that the Start menu opened.",
              };
            }

            return {
              success: true,
              action,
              message: "Start menu opened or is already accessible.",
              tree: tree.formatted?.slice(0, 2500) ?? "",
            };
          }

          // ============================================
          // CLOSE START MENU
          // ============================================

          if (action === "close") {
            if (tree) {
              await desktop.pressKey("{ESC}");
              await delay(400);

              tree = await getStartMenuTree();

              if (tree) {
                return {
                  success: false,
                  action,
                  message:
                    "Could not confirm that the Start menu closed. " +
                    "The Start window may still be accessible.",
                };
              }
            }

            return {
              success: true,
              action,
              message: "The Start menu is not accessible.",
            };
          }

          // ============================================
          // INSPECT START MENU
          // ============================================

          if (action === "inspect") {
            if (!tree) {
              return {
                success: false,
                action,
                message:
                  "The Start menu could not be inspected. " +
                  "It may not be open.",
              };
            }

            return {
              success: true,
              action,
              message: "Retrieved the Start menu accessibility tree.",
              tree: tree.formatted?.slice(0, 3500) ?? "",
            };
          }

          // ============================================
          // LOCATE APPLICATION
          // ============================================

          if (action === "locate_app") {
            const name = applicationName?.trim();

            if (!name) {
              return {
                success: false,
                action,
                message: "Provide applicationName when using locate_app.",
              };
            }

            // Step 1: Ensure the Start menu is accessible.
            if (!tree) {
              await desktop.pressKey("{Win}");
              await delay(600);

              tree = await getStartMenuTree();
            }

            if (!tree) {
              return {
                success: false,
                action,
                applicationName: name,
                message: "Could not open or inspect the Start menu.",
              };
            }

            // Step 2: Build the selector.
            const selector = `process:Start >> name:${name}`;

            // Step 3: Find the application.
            let bounds = await getElementBounds(selector);

            if (!bounds) {
              return {
                success: false,
                action,
                applicationName: name,
                message:
                  `Could not find "${name}" using its accessible name. ` +
                  "Inspect the Start menu tree to determine the exact name.",
                tree: tree.formatted?.slice(0, 2500) ?? "",
              };
            }

            console.log(
              `[StartMenuAgent] Initial bounds for "${name}":`,
              bounds,
            );

            // Step 4: Only scroll if bounds are invalid.
            let scrollResult:
              | Awaited<ReturnType<typeof scrollElementIntoView>>
              | undefined;

            if (!hasValidBounds(bounds)) {
              console.log(
                `[StartMenuAgent] "${name}" is not fully visible. Scrolling...`,
              );

              scrollResult = await scrollElementIntoView(selector, {
                maxAttempts: 30,
                scrollAmount: -400,
                scrollX: 760,
                scrollY: 650,
                screenWidth: SCREEN_WIDTH,
                screenHeight: SCREEN_HEIGHT,
                minWidth: 20,
                minHeight: 20,
                hoverDelay: 200,
                scrollDelay: 300,
                locatorTimeout: 1000,
                moveToElement: true,
              });

              console.log("[StartMenuAgent] Scroll result:", scrollResult);
            }

            // Step 5: Refresh the UI tree.
            await delay(300);

            tree = await getStartMenuTree();

            // Step 6: Reacquire the element after scrolling.
            bounds = await getElementBounds(selector, 2000);

            if (!bounds) {
              return {
                success: false,
                action,
                applicationName: name,
                message:
                  `The element "${name}" could not be reacquired ` +
                  "after scrolling.",
                error: scrollResult?.error,
                tree: tree?.formatted?.slice(0, 2500) ?? "",
              };
            }

            // Step 7: Verify the actual bounds.
            const visible = hasValidBounds(bounds);

            if (!visible) {
              return {
                success: false,
                action,
                applicationName: name,
                bounds,
                message:
                  `Found "${name}", but it is still outside the ` +
                  "acceptable visible bounds after scrolling.",
                error: scrollResult?.error,
                tree: tree?.formatted?.slice(0, 2500) ?? "",
              };
            }

            return {
              success: true,
              action,
              applicationName: name,
              bounds,
              message:
                `Located "${name}" and verified that it has visible bounds. ` +
                "The application was not launched.",
              tree: tree?.formatted?.slice(0, 1500) ?? "",
            };
          }

          return {
            success: false,
            action,
            message: "Unsupported Start menu operation.",
          };
        } catch (error) {
          return {
            success: false,
            action,
            message: "Start menu operation failed.",
            error: error instanceof Error ? error.message : String(error),
          };
        }
      },
    }),
  },
});

await delay(2000);
const result = await startMenuAgent.generate({
  prompt: "Open Start menu and open maps.",
});

console.log(result.text);
