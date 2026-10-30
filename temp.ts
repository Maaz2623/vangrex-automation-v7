import { delay } from "./src/utils/delay";
import { desktop } from "./src/utils/desktop";
import robot from "robotjs";

await delay(2000);

const element1 = await desktop
  .locator("process:Start >> role:ListItem && name:Power")
  .first(2000);

const bounds = element1.bounds();

const targetX = Math.round(bounds.x + bounds.width / 2);
const targetY = Math.round(bounds.y + bounds.height / 2);

robot.moveMouseSmooth(targetX, targetY);
robot.mouseClick();

await delay(2000);

const element2 = await desktop
  .locator("process:Start >> role:Button && name:Shut down")
  .first(2000);

const shutdownBounds = element2.bounds();

const shutdownTargetX = Math.round(shutdownBounds.x + shutdownBounds.width / 2);
const shutdownTargetY = Math.round(
  shutdownBounds.y + shutdownBounds.height / 2,
);

robot.moveMouseSmooth(shutdownTargetX, shutdownTargetY);
robot.mouseClick();
