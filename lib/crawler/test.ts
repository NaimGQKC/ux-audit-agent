/**
 * Test script for the Playwright crawler.
 *
 * Usage:
 *   npx tsx lib/crawler/test.ts https://example.com
 */

import { crawlAndScreenshot } from "../../src/lib/crawler";

async function main() {
  const url = process.argv[2];

  if (!url) {
    console.error("Usage: npx tsx lib/crawler/test.ts <url>");
    console.error("  e.g. npx tsx lib/crawler/test.ts https://example.com");
    process.exit(1);
  }

  try {
    new URL(url);
  } catch {
    console.error(`Invalid URL: ${url}`);
    process.exit(1);
  }

  console.log(`\nCrawling ${url} ...\n`);

  try {
    const manifest = await crawlAndScreenshot(url);

    console.log("\n--- Manifest ---");
    console.log(JSON.stringify(manifest, null, 2));
    console.log(`\nDone — ${manifest.totalRoutes} route(s) screenshotted.`);
  } catch (err) {
    console.error("Crawl failed:", (err as Error).message);
    process.exit(1);
  }
}

main();
