import User32 from "@bun-win32/user32";
import { desktop } from "./src/utils/desktop";
import { Terminator } from "./src/utils/terminator";

type ForegroundApp = {
  hwnd: bigint;
  processId: number;
  title: string;
};

function getForegroundApp(): ForegroundApp | null {
  const hwnd = User32.GetForegroundWindow();

  if (hwnd === 0n) {
    return null;
  }

  const pidBuffer = Buffer.alloc(4);
  User32.GetWindowThreadProcessId(hwnd, pidBuffer.ptr);

  const processId = pidBuffer.readUInt32LE(0);

  const titleBuffer = Buffer.alloc(1024);
  User32.GetWindowTextW(hwnd, titleBuffer.ptr, 512);

  const title = new TextDecoder("utf-16le").decode(titleBuffer).split("\0")[0];

  return { hwnd, processId, title };
}

function getProcessName(processId: number): string {
  const result = Bun.spawnSync({
    cmd: [
      "powershell.exe",
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `(Get-Process -Id ${processId} -ErrorAction SilentlyContinue).ProcessName`,
    ],
    stdout: "pipe",
    stderr: "ignore",
  });

  return Buffer.from(result.stdout).toString("utf8").trim() || "Unknown";
}

async function main() {
  let previousHwnd: bigint | null = null;
  console.log(
    "Monitoring foreground application changes... Press Ctrl+C to stop.\n",
  );

  while (true) {
    try {
      const app = getForegroundApp();

      if (app && app.hwnd !== previousHwnd) {
        const processName = getProcessName(app.processId);

        console.log("Application changed");
        console.log(`  Process:   ${processName}`);
        console.log(`  PID:       ${app.processId}`);
        console.log(`  HWND:      ${app.hwnd}`);
        console.log(`  Title:     ${app.title || "(untitled)"}`);
        console.log("----------------------------------------");

        previousHwnd = app.hwnd;
        const tree = await desktop.getWindowTreeResult(processName, app.title, {
          treeOutputFormat: Terminator.TreeOutputFormat.ClusteredYaml,
          formatOutput: true,
          propertyMode: Terminator.PropertyLoadingMode.Complete,
          includeWindowScreenshot: false,
        });

        console.log(tree.formatted?.slice(0, 500));
      }
    } catch (error) {
      console.error("Foreground detection error:", error);
    }

    await Bun.sleep(500);
  }
}

main();
