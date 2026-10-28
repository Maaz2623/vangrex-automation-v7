import {
  cli,
  inference,
  ServerOptions,
  voice,
  defineAgent,
} from "@livekit/agents";
import { createAgent } from "./agent.ts";
import { audioEnhancement, EnhancerModel } from "@livekit/plugins-ai-coustics";
import { fileURLToPath } from "node:url";
import "dotenv/config";

export default defineAgent({
  entry: async (ctx) => {
    const session = new voice.AgentSession({
      stt: new inference.STT({
        model: "assemblyai/universal-3-6-pro",
        language: "en",
      }),

      tts: new inference.TTS({
        model: "fishaudio/s2.1-pro",
        voice: "fa4c9eb3dccc4806b382b40d61c6b10a",
      }),

      turnHandling: {
        turnDetection: new inference.TurnDetector(),

        preemptiveGeneration: {
          enabled: true,
        },
      },
      expressive: true,
    });

    await session.start({
      agent: createAgent(),
      room: ctx.room,
      inputOptions: {
        noiseCancellation: audioEnhancement({
          model: EnhancerModel.QuailVfS,
        }),
      },
    });

    await ctx.connect();

    session.generateReply({
      instructions:
        "Greet Mohammed Maaz. You boss like Tony Start was for Jarvis.",
    });
  },
});

cli.runApp(
  new ServerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName: "my-agent",
  }),
);
