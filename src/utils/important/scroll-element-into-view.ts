import robot from "robotjs";
import { desktop } from "../desktop";
import { delay } from "../delay";

export interface ScrollElementOptions {
  /** Maximum number of attempts. */
  maxAttempts?: number;

  /** Mouse-wheel amount. Negative and positive values scroll in opposite directions. */
  scrollAmount?: number;

  /** Coordinates of the scrollable region. */
  scrollX?: number;
  scrollY?: number;

  /** Screen dimensions. */
  screenWidth?: number;
  screenHeight?: number;

  /** Minimum acceptable element dimensions. */
  minWidth?: number;
  minHeight?: number;

  /** Delay after moving the mouse. */
  hoverDelay?: number;

  /** Delay after scrolling. */
  scrollDelay?: number;

  /** Timeout when searching for the element. */
  locatorTimeout?: number;

  /** Move the mouse to the element when found. */
  moveToElement?: boolean;
}

export interface ScrollElementResult {
  success: boolean;
  selector: string;
  attempts: number;
  bounds?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  error?: string;
}

type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function hasValidBounds(
  bounds: Bounds,
  options: Required<ScrollElementOptions>,
): boolean {
  return (
    bounds.width >= options.minWidth &&
    bounds.height >= options.minHeight &&
    bounds.x >= 0 &&
    bounds.y >= 0 &&
    bounds.x + bounds.width <= options.screenWidth &&
    bounds.y + bounds.height <= options.screenHeight
  );
}

export async function scrollElementIntoView(
  selector: string,
  options: ScrollElementOptions = {},
): Promise<ScrollElementResult> {
  const config: Required<ScrollElementOptions> = {
    maxAttempts: options.maxAttempts ?? 30,
    scrollAmount: options.scrollAmount ?? -400,
    scrollX: options.scrollX ?? 760,
    scrollY: options.scrollY ?? 650,
    screenWidth: options.screenWidth ?? 1920,
    screenHeight: options.screenHeight ?? 1080,
    minWidth: options.minWidth ?? 20,
    minHeight: options.minHeight ?? 20,
    hoverDelay: options.hoverDelay ?? 200,
    scrollDelay: options.scrollDelay ?? 300,
    locatorTimeout: options.locatorTimeout ?? 1000,
    moveToElement: options.moveToElement ?? true,
  };

  if (config.maxAttempts < 1) {
    return {
      success: false,
      selector,
      attempts: 0,
      error: "maxAttempts must be at least 1.",
    };
  }

  for (let attempt = 1; attempt <= config.maxAttempts; attempt++) {
    try {
      // Reacquire the element on every attempt.
      const element = await desktop
        .locator(selector)
        .first(config.locatorTimeout);

      const bounds = await element.bounds();

      console.log(
        `[ScrollIntoView] Attempt ${attempt}/${config.maxAttempts}:`,
        bounds,
      );

      if (hasValidBounds(bounds, config)) {
        if (config.moveToElement) {
          const targetX = Math.round(bounds.x + bounds.width / 2);

          const targetY = Math.round(bounds.y + bounds.height / 2);

          robot.moveMouseSmooth(targetX, targetY);
          robot.mouseClick();
        }

        console.log(`[ScrollIntoView] Element is visible: ${selector}`);

        return {
          success: true,
          selector,
          attempts: attempt,
          bounds,
        };
      }
    } catch (error) {
      // A locator timeout should not terminate the entire operation.
      console.log(
        `[ScrollIntoView] Attempt ${attempt}: element unavailable.`,
        error instanceof Error ? error.message : String(error),
      );
    }

    // Do not scroll again after the final attempt.
    if (attempt === config.maxAttempts) {
      break;
    }

    try {
      // Hover over the configured scrollable region.
      robot.moveMouse(config.scrollX, config.scrollY);

      await delay(config.hoverDelay);

      // Scroll the region under the mouse.
      robot.scrollMouse(0, config.scrollAmount);

      await delay(config.scrollDelay);
    } catch (error) {
      return {
        success: false,
        selector,
        attempts: attempt,
        error:
          "Scrolling failed: " +
          (error instanceof Error ? error.message : String(error)),
      };
    }
  }

  return {
    success: false,
    selector,
    attempts: config.maxAttempts,
    error:
      "Element was not found with usable bounds after all attempts. " +
      "Check the selector, application state, and scroll-container coordinates.",
  };
}
