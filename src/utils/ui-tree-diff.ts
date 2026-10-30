import { desktop } from "./desktop";
import robot from "robotjs";

export type UiActionResult = {
  success: boolean;
  uiDiff: string | undefined;
  error?: string;
  hasChanges?: boolean;
};

export async function clickWithUiDiff(
  role: string,
  name: string,
): Promise<UiActionResult> {
  try {
    const app = await desktop.getCurrentApplication();

    const selector = `role:${role} && text:${name}`;
    const element = await app.locator(selector).first(2000);

    const bounds = element.bounds();

    const targetX = Math.round(bounds.x + bounds.width / 2);
    const targetY = Math.round(bounds.y + bounds.height / 2);

    robot.moveMouseSmooth(targetX, targetY);

    const result = await element.click({
      uiDiffBeforeAfter: true,
    });

    return {
      success: true,
      uiDiff: result.uiDiff?.diff,
      hasChanges: result.uiDiff?.hasChanges,
    };
  } catch (error) {
    return {
      success: false,
      uiDiff: undefined,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
