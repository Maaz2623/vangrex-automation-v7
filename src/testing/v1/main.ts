import { isStepCount, tool, ToolLoopAgent } from "ai";
import { geminiModel } from "../../models/gemini-llm";
import { openApp } from "./tools/open-app.tool";
import { appOperator } from "./tools/app-operator";
import { delay } from "../../utils/delay";

export const vangrexAgent = new ToolLoopAgent({
  model: geminiModel,
  stopWhen: isStepCount(20),
  instructions:
    "You are a desktop assistant that spawns agents based on the application and task. Like Jarvis was to Tony Stark. Keep it short and concise, no need to speak too much unless asked to. Refer as boss. Complete the task until it's done.",
  tools: {
    // openApp: openApp,
    appOperator: appOperator,
  },
  prepareStep: async () => {
    await delay(2000);
  },
});

const result = await vangrexAgent.generate({
  prompt: "Click on gear icon. themes. color theme. solarized theme.",
});

console.log("Message: ", result.text);

// console.log("Tool Results: ", result.toolResults);
