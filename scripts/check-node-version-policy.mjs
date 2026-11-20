import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NODE_MAJOR, isNodeImageTag } from "./node-image-policy.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expectedEngine = `>=${NODE_MAJOR}.0.0`;
const typesMajor = `^${NODE_MAJOR}.`;
const failures = [];
const skippedDirectories = new Set([".git", ".paperclip", "coverage", "data", "dist", "node_modules"]);

function relative(filePath) {
  return path.relative(repoRoot, filePath) || ".";
}

function walk(directory, visit) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(entryPath, visit);
    else if (entry.isFile()) visit(entryPath);
  }
}

// The workspace catalog is the single source of dependency versions; package.json files reference it.
const workspaceManifest = fs.readFileSync(path.join(repoRoot, "pnpm-workspace.yaml"), "utf8");
const catalogTypes = /^ {2}"?@types\/node"?:\s*"([^"]+)"/m.exec(workspaceManifest)?.[1];
if (!catalogTypes?.startsWith(typesMajor)) {
  failures.push(`pnpm-workspace.yaml: catalog @types/node must be ${typesMajor}x, found ${catalogTypes ?? "missing"}`);
}

walk(repoRoot, (filePath) => {
  if (path.basename(filePath) !== "package.json") return;
  const manifest = JSON.parse(fs.readFileSync(filePath, "utf8"));
  for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
    const specifier = manifest[section]?.["@types/node"];
    if (specifier && specifier !== "catalog:" && !specifier.startsWith(typesMajor)) {
      failures.push(`${relative(filePath)}: ${section}.@types/node must be catalog: or ${typesMajor}x, found ${specifier}`);
    }
  }
  // The runner's kimi/pi distributions install under their own pinned Node 24.21.0 interpreter.
  if (/scripts[\\/](kimi|pi)-distribution[\\/]package\.json$/.test(filePath)) return;
  if (manifest.engines?.node !== expectedEngine) {
    failures.push(`${relative(filePath)}: engines.node must be ${expectedEngine}, found ${manifest.engines?.node ?? "missing"}`);
  }
});

walk(path.join(repoRoot, ".github", "workflows"), (filePath) => {
  if (!/\.ya?ml$/.test(filePath)) return;
  const source = fs.readFileSync(filePath, "utf8");
  for (const match of source.matchAll(/node-version:\s*["']?([^\s"'#]+)/g)) {
    if (match[1] !== String(NODE_MAJOR)) failures.push(`${relative(filePath)}: node-version must be ${NODE_MAJOR}, found ${match[1]}`);
  }
});

walk(repoRoot, (filePath) => {
  if (!path.basename(filePath).startsWith("Dockerfile")) return;
  const source = fs.readFileSync(filePath, "utf8");
  for (const match of source.matchAll(/^\s*FROM\s+node:([^\s]+)/gm)) {
    if (!isNodeImageTag(match[1])) failures.push(`${relative(filePath)}: Node base image must use the Node ${NODE_MAJOR} major, found node:${match[1]}`);
  }
  for (const match of source.matchAll(/^\s*ARG\s+NODE_(?:MAJOR|VERSION)=([^\s]+)/gm)) {
    if (match[1] !== String(NODE_MAJOR)) failures.push(`${relative(filePath)}: Node build argument must be ${NODE_MAJOR}, found ${match[1]}`);
  }
});

const nvmrc = path.join(repoRoot, ".nvmrc");
if (fs.existsSync(nvmrc) && fs.readFileSync(nvmrc, "utf8").trim() !== String(NODE_MAJOR)) {
  failures.push(`.nvmrc: must be ${NODE_MAJOR}`);
}

if (failures.length > 0) {
  console.error("Node version policy check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Node version policy check passed (Node ${expectedEngine}, @types/node ${NODE_MAJOR}.x).`);
