import type { Browser, Page } from "@playwright/test";

/** Source HTML is inert; only the caller's trusted Playwright inspection runs. */
export async function withInertReferencePage<T>(
  browser: Browser,
  html: string,
  inspect: (page: Page) => Promise<T>,
): Promise<T> {
  const context = await browser.newContext({
    javaScriptEnabled: false,
    serviceWorkers: "block",
    offline: true,
    acceptDownloads: false,
  });
  try {
    await context.route("**/*", (route) => route.abort("blockedbyclient"));
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.setContent(html);
    return await inspect(page);
  } finally {
    await context.close();
  }
}
