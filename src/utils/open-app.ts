import robot from "robotjs";
import { desktop } from "./desktop";
import { Terminator } from "./terminator";
import { delay } from "./delay";

export interface OpenAppOptions {
  /** Time to wait before starting the search. */
  initialDelay?: number;

  /** Time to wait for Windows Search results. */
  searchDelay?: number;

  /** Timeout for locating UI elements. */
  timeout?: number;
}

export async function openApp(
  appName: string,
  options: OpenAppOptions = {},
): Promise<boolean> {
  const { initialDelay = 1000, searchDelay = 1500, timeout = 3000 } = options;

  try {
    // 1. Allow the desktop to become ready.
    await delay(initialDelay);

    // 2. Find the Windows Start search box.
    const searchBox = await desktop
      .locator("process:Start >> role:Edit && name:Search box")
      .first(timeout);

    // 3. Click the center of the search box.
    const searchBoxBounds = searchBox.bounds();

    const searchX = Math.round(searchBoxBounds.x + searchBoxBounds.width / 2);

    const searchY = Math.round(searchBoxBounds.y + searchBoxBounds.height / 2);

    robot.moveMouseSmooth(searchX, searchY);
    robot.mouseClick();

    await delay(200);

    // 4. Search for the application.
    await searchBox.typeText(appName, {
      clearBeforeTyping: true,
      includeWindowScreenshot: false,
    });

    // 5. Wait for Windows Search results.
    await delay(searchDelay);

    // Refresh the Search UI tree.
    await desktop.getWindowTreeResult("Search", undefined, {
      formatOutput: true,
      treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
      propertyMode: Terminator.PropertyLoadingMode.Complete,
    });

    // 6. Locate the application in Windows Search.
    const appButton = await desktop
      .locator(`process:Search >> role:Button && name:${appName}`)
      .first(timeout);

    // 7. Click the center of the application button.
    const appBounds = appButton.bounds();

    const appX = Math.round(appBounds.x + appBounds.width / 2);

    const appY = Math.round(appBounds.y + appBounds.height / 2);

    robot.moveMouseSmooth(appX, appY);
    robot.mouseClick();

    return true;
  } catch (error) {
    console.error(`Failed to open application "${appName}":`, error);
    return false;
  }
}
