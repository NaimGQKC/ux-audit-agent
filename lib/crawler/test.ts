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
    const outcome = await crawlAndScreenshot(url);

    if ("needsAuth" in outcome && outcome.needsAuth) {
      console.log("Auth required:", outcome.authUrl);
      process.exit(1);
    }
    if ("needsSSOLogin" in outcome && outcome.needsSSOLogin) {
      console.log("SSO login required, redirected to:", outcome.redirectUrl);
      process.exit(1);
    }

    const manifest = outcome.manifest;
    console.log("\n--- Manifest ---");
    console.log(JSON.stringify(manifest, null, 2));
    console.log(`\nDone — ${manifest.totalRoutes} route(s) screenshotted.`);
  } catch (err) {
    console.error("Crawl failed:", (err as Error).message);
    process.exit(1);
  }
}

main();
