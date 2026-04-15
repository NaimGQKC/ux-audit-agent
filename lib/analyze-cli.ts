/**
 * CLI entry point for the standalone analyzer.
 * Used by analyze.sh — see that script for the user-facing interface.
 *
 *   npx tsx lib/analyze-cli.ts <screenshots-dir> [prd-context-file]
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { analyzeScreenshotsDir } from "../src/lib/analyzer/run";

async function main() {
  const screenshotsDir = process.argv[2];
  const prdContextFile = process.argv[3];

  if (!screenshotsDir) {
    console.error("Usage: tsx lib/analyze-cli.ts <screenshots-dir> [prd-context-file]");
    process.exit(1);
  }

  const resolvedDir = path.resolve(screenshotsDir);
  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.error(`Screenshots directory not found: ${resolvedDir}`);
    process.exit(1);
  }

  let prdContext: string | undefined;
  if (prdContextFile) {
    const resolved = path.resolve(prdContextFile);
    if (!fs.existsSync(resolved)) {
      console.error(`PRD context file not found: ${resolved}`);
      process.exit(1);
    }
    prdContext = fs.readFileSync(resolved, "utf8");
  }

  const outputFile = path.join(resolvedDir, "analysis-results.json");
  console.error(`Analyzing screenshots in ${resolvedDir} ...`);

  const result = await analyzeScreenshotsDir(resolvedDir, {
    prdContext,
    onProgress: (msg, current, total) =>
      console.error(`  [${current + 1}/${total}] ${msg}`),
  });

  fs.writeFileSync(
    outputFile,
    JSON.stringify({ screenshots: result.screenshots }, null, 2),
  );

  const totalIssues = Object.values(result.screenshots).reduce(
    (acc, s) => acc + (s.issues?.length ?? 0),
    0,
  );
  console.error(
    `Analysis complete: ${outputFile}\n` +
      `  ${result.totalBatches} batch(es), ${result.failedBatches} failed, ${totalIssues} total issue(s)`,
  );
}

main().catch((err) => {
  console.error("Analysis failed:", (err as Error).message);
  process.exit(1);
});
