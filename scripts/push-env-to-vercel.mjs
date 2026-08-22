#!/usr/bin/env node
/**
 * Pushes every variable from .env.local into Vercel env (prod/preview/dev).
 * Values are read from the local file and piped straight into the CLI —
 * never echoed to the terminal.
 *
 * Usage: node scripts/push-env-to-vercel.mjs
 */
import { readFileSync } from "fs";
import { execSync } from "child_process";

const ENV_TARGETS = ["production", "preview", "development"];

function parseEnvFile(path) {
  const vars = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith("#")) continue;
    const [, key, raw] = m;
    // strip optional surrounding quotes
    const value = raw.replace(/^["'](.*)["']$/, "$1");
    if (value !== "") vars[key] = value;
  }
  return vars;
}

const vars = parseEnvFile(".env.local");
const keys = Object.keys(vars);
if (keys.length === 0) {
  console.error("No variables found in .env.local");
  process.exit(1);
}

console.log(`Pushing ${keys.length} variables × ${ENV_TARGETS.length} environments...\n`);

for (const key of keys) {
  for (const target of ENV_TARGETS) {
    // Remove silently if it exists, then add fresh.
    try {
      execSync(`vercel env rm ${key} ${target} --yes`, { stdio: "ignore" });
    } catch {
      /* didn't exist */
    }
    try {
      execSync(`vercel env add ${key} ${target}`, {
        input: vars[key],
        stdio: ["pipe", "ignore", "pipe"],
      });
      console.log(`✓ ${key} → ${target}`);
    } catch (err) {
      console.error(`✗ ${key} → ${target}: ${err.stderr?.toString() ?? err.message}`);
      process.exit(1);
    }
  }
}

console.log("\nAll environment variables pushed.");
