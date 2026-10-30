import { delay } from "./src/utils/delay";
import { desktop } from "./src/utils/desktop";

const MAX_DEPTH = 6;
const MAX_NODES = 150;
const ELEMENT_TIMEOUT_MS = 1500;

type TreeNode = {
  role: string | null;
  name: string | null;
  bounds: unknown;
  children: TreeNode[];
  error?: string;
};

let visitedNodes = 0;

async function inspectElement(
  element: Awaited<ReturnType<typeof desktop.locator>["first"]> extends never
    ? never
    : any,
  depth: number,
): Promise<TreeNode> {
  const node: TreeNode = {
    role: null,
    name: null,
    bounds: null,
    children: [],
  };

  try {
    node.role = await element.role();
    node.name = await element.name();
    node.bounds = await element.bounds();
  } catch (error) {
    node.error = String(error);
    return node;
  }

  visitedNodes++;

  if (depth >= MAX_DEPTH || visitedNodes >= MAX_NODES) {
    return node;
  }

  try {
    // children() is synchronous in the installed Terminator API.
    const children = element.children();

    for (const child of children) {
      if (visitedNodes >= MAX_NODES) break;

      node.children.push(await inspectElement(child, depth + 1));
    }
  } catch (error) {
    node.error = String(error);
  }

  return node;
}

await delay(1000);

console.log("Finding Start window...");

const start = await desktop.locator("role:Window|name:Start").first(2000);

console.log("Start found. Traversing manually...");

const tree = await inspectElement(start, 0);

console.log("Traversal finished. Nodes:", visitedNodes);

console.dir(tree, { depth: null });
