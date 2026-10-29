import { tool } from "ai";
import z from "zod";
import { desktop } from "../../../utils/desktop";

export const openApp = tool({
  description: "Use to search and open applications.",
  inputSchema: z.object({
    appName: z.string(),
  }),
  execute: async ({ appName }) => {
    try {
      const currenApplication = await desktop.getCurrentApplication();

      if (currenApplication.processName() === appName) {
        return {
          success: true,
          message: `${appName} is already open, continuing in this instance.`,
        };
      } else {
        const app = desktop.openApplication(appName);

        app.focus();
      }

      return {
        success: true,
        message: `${appName} is ready.`,
      };
    } catch (error) {
      return {
        success: false,
        message: `${error instanceof Error ? error.message : error}`,
      };
    }
  },
});
