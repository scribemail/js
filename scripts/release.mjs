// Interactive release cutter — run via `pnpm release`.
//
// Prompts for the version bump, then does everything behind the scenes:
//   1. preflight (on a clean tree),
//   2. local verify (typecheck + test + build) so a broken release never gets tagged,
//   3. `pnpm version` (bumps package.json + commits + creates the vX.Y.Z tag),
//   4. push the branch + tag — which triggers .github/workflows/release.yml
//      (npm publish → Cloudflare R2 upload → edge-cache purge → GitHub Release).
import { execFileSync, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const sh = (cmd) => execSync(cmd, { encoding: "utf8" }).trim();
const run = (cmd, args) => execFileSync(cmd, args, { stdio: "inherit" });

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// --- Preflight -----------------------------------------------------------------------------------
let branch;
try {
  branch = sh("git rev-parse --abbrev-ref HEAD");
} catch {
  fail("Not a git repository.");
}
if (sh("git status --porcelain")) {
  fail("Working tree is not clean — commit or stash your changes before releasing.");
}

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const current = pkg.version;
const [maj, min, pat] = current.split(".").map(Number);
const next = { patch: `${maj}.${min}.${pat + 1}`, minor: `${maj}.${min + 1}.0`, major: `${maj + 1}.0.0` };

const rl = createInterface({ input, output });
const ask = async (q) => (await rl.question(q)).trim();
const yes = (s) => s.toLowerCase() === "y" || s.toLowerCase() === "yes";

if (branch !== "main") {
  if (!yes(await ask(`⚠ You are on "${branch}", not "main". Continue anyway? [y/N] `))) {
    rl.close();
    fail("Aborted.");
  }
}

console.log(`\nCurrent version: v${current}\n`);
console.log(`  1) patch  →  v${next.patch}`);
console.log(`  2) minor  →  v${next.minor}`);
console.log(`  3) major  →  v${next.major}`);
console.log(`  4) custom`);

let bumpArg;
let target;
switch (await ask("\nSelect a bump [1-4]: ")) {
  case "1": bumpArg = "patch"; target = next.patch; break;
  case "2": bumpArg = "minor"; target = next.minor; break;
  case "3": bumpArg = "major"; target = next.major; break;
  case "4": {
    const v = (await ask("Enter version (x.y.z): ")).replace(/^v/, "");
    if (!/^\d+\.\d+\.\d+$/.test(v)) { rl.close(); fail(`"${v}" is not a valid x.y.z version.`); }
    bumpArg = v; target = v; break;
  }
  default: rl.close(); fail("Aborted — no valid option selected.");
}

if (!yes(await ask(`\nRelease v${target}? This verifies, tags, and pushes. [y/N] `))) {
  rl.close();
  fail("Aborted.");
}
rl.close();

// --- Verify (fail before tagging, not after) -----------------------------------------------------
console.log("\n▸ Verifying (typecheck + test + build)…");
try {
  run("pnpm", ["typecheck"]);
  run("pnpm", ["test"]);
  run("pnpm", ["build"]);
} catch {
  fail("Pre-release checks failed — nothing was tagged.");
}

// --- Bump + tag + push ---------------------------------------------------------------------------
console.log(`\n▸ Bumping to v${target} and tagging…`);
run("pnpm", ["version", bumpArg, "--message", "release: v%s"]);
console.log("\n▸ Pushing branch + tag…");
run("git", ["push", "--follow-tags", "origin", "HEAD"]);

console.log(`\n✔ Released v${target}. GitHub Actions is publishing to npm + R2:`);
console.log("  https://github.com/scribemail/js/actions\n");
