import { isStepCount, tool, ToolLoopAgent } from "ai";
import { geminiModel } from "../../models/gemini-llm";
import { openApp } from "./tools/open-app.tool";
import { browserOperator } from "./tools/browser-operator.tool";
import { delay } from "../../utils/delay";

export const vangrexAgent = new ToolLoopAgent({
  model: geminiModel,
  stopWhen: isStepCount(20),
  instructions:
    "You are a desktop assistant that spawns agents based on the application and task. Like Jarvis was to Tony Stark. Keep it short and concise, no need to speak too much unless asked to. Refer as boss.",
  tools: {
    openApp: openApp,
    browserOperator: browserOperator,
  },
  prepareStep: async () => {
    await delay(2000);
  },
});

const result = await vangrexAgent.generate({
  prompt: "Fill out the form. Dummy values.",
});

console.log("Message: ", result.text);

console.log("Tool Results: ", result.toolResults);
