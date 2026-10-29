import { delay } from "@livekit/agents";
import { desktop } from "./src/utils/desktop";
import { Terminator } from "./src/utils/terminator";
import { generateText, Output } from "ai";
import { geminiModel } from "./src/models/gemini-llm";
import z from "zod";
import robot from "robotjs";

const task = "Change theme to solarized light.";

let step = "";

let app = await desktop.getCurrentApplication();

let tree = desktop.getWindowTreeResult(app.processName(), undefined, {
  formatOutput: true,
  treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
  propertyMode: Terminator.PropertyLoadingMode.Complete,
});

for (let i = 0; i <= 4; i++) {
  const performStep = await generateText({
    model: geminiModel,
    instructions:
      "Understand the ui tree and generate object to perform the next step.",
    prompt: `Task: ${task}. App: ${app.processName()}. UI Tree: ${tree.formatted}. Next Step: ${step}`,
    output: Output.object({
      schema: z.object({
        status: z.object({
          isTaskComplete: z
            .boolean()
            .describe("Wether this step completes the entire task."),
          reason: z
            .string()
            .describe(
              "The reason for why this step completes or doesn't complete the task.",
            ),
          nextStep: z
            .string()
            .describe(
              "If this step doesn't complete the task. The next step to perform.",
            )
            .optional(),
        }),
        element: z
          .object({
            name: z.string(),
            role: z.string(),
          })
          .describe("The element to perform the action on.")
          .optional(),
        action: z
          .object({
            click: z.boolean().optional(),
          })
          .describe("The action to perform on the element.")
          .optional(),
      }),
    }),
  });

  const output = performStep.output;

  if (
    !performStep.output.status.isTaskComplete &&
    performStep.output.status.nextStep
  ) {
    step = performStep.output.status.nextStep;
  }

  if (
    performStep.output.action &&
    performStep.output.action.click &&
    output.element
  ) {
    const selector = `role:${output.element.role} && text:${output.element.name}`;

    const element = await app.locator(selector).first(2000);

    const bounds = element.bounds();

    const targetX = Math.round(bounds.x + bounds.width / 2);
    const targetY = Math.round(bounds.y + bounds.height / 2);

    robot.moveMouseSmooth(targetX, targetY);
    robot.mouseClick();

    tree = desktop.getWindowTreeResult(app.processName(), undefined, {
      formatOutput: true,
      treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
      propertyMode: Terminator.PropertyLoadingMode.Complete,
    });
  }
  console.log("Output: ", performStep.output);
}
