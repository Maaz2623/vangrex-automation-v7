import { generateText, Output, tool } from "ai";
import z from "zod";
import { desktop } from "../../../utils/desktop";
import { Terminator } from "../../../utils/terminator";
import { geminiModel } from "../../../models/gemini-llm";
import robot from "robotjs";
import { delay } from "../../../utils/delay";

export const browserOperator = tool({
  description: "Use to operate browser",
  inputSchema: z.object({
    task: z
      .string()
      .describe("The step of a step by step workflow task to perform."),
  }),
  execute: async ({ task }) => {
    try {
      const app = await desktop.getCurrentBrowserWindow();

      if (!app) {
        throw new Error("Not a browser window.");
      }

      const tree = desktop.getWindowTreeResult(app.processName(), app.name(), {
        formatOutput: true,
        treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
        propertyMode: Terminator.PropertyLoadingMode.Complete,
      });

      const actionResult = await generateText({
        model: geminiModel,
        instructions: "Responsible to read the ui and perform the action.",
        prompt: `Current State: ${tree.formatted}. Task is ${task}. Browser: ${app.processName()}`,
        output: Output.object({
          schema: z.object({
            requiresAction: z.boolean(),
            requiresActionReason: z.string(),
            doesActionCompleteTask: z
              .boolean()
              .describe(
                "Wether the action performed or to perform completed the task. set true if it requires further actions and set false if the current action completes the over all task.",
              ),
            doesActionCompleteTaskReason: z.string(
              "Reason to wether the action completes or doesn't complete the task. Give next step instructions based on current state.`",
            ),
            click: z
              .object({
                clickType: z.enum(["left", "right", "double"]),
                elementName: z.string(),
                elementRole: z
                  .string()
                  .describe("Pascal Casing Always. No guessing."),
              })
              .optional()
              .describe("Use only when required."),
            type: z
              .object({
                elementName: z.string(),
                elementRole: z
                  .string()
                  .describe("Pascal Casing Always. No guessing."),
                pressEnterAfterTyping: z
                  .boolean()
                  .describe(
                    "Wether to press after typing the text. Use for search inputs.",
                  ),
                clearBeforeTyping: z
                  .boolean()
                  .describe(
                    "Wether to clear the input box text which is already present and then start typing.",
                  ),
                textToType: z.string().describe("The text to type in the box."),
              })
              .optional()
              .describe("Use only when required."),
          }),
        }),
      });

      console.log(actionResult.output);

      if (!actionResult.output.requiresAction) {
        return {
          success: true,
          message: `Action required: ${actionResult.output.requiresAction}. Reason: ${actionResult.output.requiresActionReason}`,
        };
      }

      if (actionResult.output.requiresAction && actionResult.output.type) {
        const type = actionResult.output.type;

        const selector = `role:${type.elementRole} && text:${type.elementName}`;

        const element = await app.locator(selector).first(3000);

        if (!element) {
          throw new Error("Element not found");
        }

        const bounds = element.bounds();

        const targetX = Math.round(bounds.x + bounds.width / 2);
        const targetY = Math.round(bounds.y + bounds.height / 2);

        robot.moveMouseSmooth(targetX, targetY, -1);
        robot.mouseClick("left");

        robot.typeStringDelayed(type.textToType, 500);

        if (type.pressEnterAfterTyping) {
          element.pressKey(`{Enter}`);
        }
      }

      if (actionResult.output.requiresAction && actionResult.output.click) {
        const click = actionResult.output.click;

        const selector = `role:${click.elementRole} && text:${click.elementName}`;

        const element = await app.locator(selector).first(3000);

        if (!element) {
          throw new Error("Element not found");
        }

        const bounds = element.bounds();

        const targetX = Math.round(bounds.x + bounds.width / 2);
        const targetY = Math.round(bounds.y + bounds.height / 2);

        robot.moveMouseSmooth(targetX, targetY, -1);
        robot.mouseClick(
          click.clickType === "left" ? "left" : "right",
          click.clickType === "double",
        );
      }

      return {
        success: true,
        message: `${actionResult.output.doesActionCompleteTaskReason}`,
      };
    } catch (error) {
      return {
        success: false,
        message: `${error instanceof Error ? error.message : error}`,
      };
    }
  },
});
