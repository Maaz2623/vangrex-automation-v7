import { desktop } from "./src/utils/desktop";
import { openApp } from "./src/utils/open-app";

await desktop.pressKey(`{Win}`);

const success = await openApp("Chrome");

console.log(
  success ? "Application opened successfully." : "Failed to open application.",
);
