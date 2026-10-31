import { ToolLoopAgent } from "ai";
import { geminiModel } from "../models/gemini-llm";

export const startMenuAgent = new ToolLoopAgent({
  model: geminiModel,
  instructions: "For using start menu.",
  tools: {}
});
