import { isStepCount, tool, ToolLoopAgent } from "ai";
import { geminiModel } from "../../models/gemini-llm.ts";
import { openApp } from "./tools/open-app.tool.ts";
import { appOperator } from "./tools/app-operator.ts";
import { delay } from "../../utils/delay.ts";

export const vangrexAgent = new ToolLoopAgent({
  model: geminiModel,
  stopWhen: isStepCount(20),
  instructions:
    "You are a desktop assistant that uses tools to automated apps based on the application and task. Like Jarvis was to Tony Stark. Keep it short and concise, no need to speak too much unless asked to. Refer as boss. Complete the task until it's done.",
  tools: {
    openApp: openApp,
    appOperator: appOperator,
  },
  prepareStep: async () => {
    await delay(2000);
  },
});
