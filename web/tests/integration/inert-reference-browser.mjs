import { chromium, expect } from "@playwright/test";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { withInertReferencePage } from "./inert-reference.ts";

/** Exercise the browser policy itself, including trusted evaluate with source JS disabled. */
export async function verifyInertReference(browser) {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.setHeader("Content-Type", "text/javascript");
    response.end('document.documentElement.dataset.executed = "network"');
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const execute = 'document.documentElement.dataset.executed = "source"';
  const cases = [
    ["script", `<script>${execute}</script>`],
    ["mixed-case closing tag", `<ScRiPt>${execute}</ScRiPt >`],
    [
      "inline event",
      `<button id="trigger" onclick='${execute}'>Probe</button>`,
    ],
    ["image error", `<img src="${origin}/image" onerror='${execute}'>`],
    ["svg load", `<svg onload='${execute}'></svg>`],
    [
      "external resources",
      `<script src="${origin}/script"></script><link rel="stylesheet" href="${origin}/style"><iframe src="${origin}/frame"></iframe>`,
    ],
  ];
  const before = browser.contexts().length,
    receipts = [];
  try {
    for (const [name, payload] of cases) {
      const html = `<style>#probe { color: rgb(12,34,56); transition: opacity 240ms cubic-bezier(.2,.8,.2,1) }</style><p id="probe">Reference style</p>${payload}`;
      const result = await withInertReferencePage(browser, html, (page) =>
        page.evaluate(() => {
          document.querySelector("#trigger")?.click();
          // Trusted inspection still works with JavaScript disabled for the document.
          const style = getComputedStyle(document.querySelector("#probe"));
          return {
            trustedEvaluateRan: true,
            sourceExecuted: document.documentElement.dataset.executed ?? null,
            color: style.color,
            duration: style.transitionDuration,
            property: style.transitionProperty,
            easing: style.transitionTimingFunction,
            scriptElements: document.querySelectorAll("script").length,
          };
        }),
      );
      expect(result).toMatchObject({
        trustedEvaluateRan: true,
        sourceExecuted: null,
        color: "rgb(12, 34, 56)",
        duration: "0.24s",
        property: "opacity",
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
      if (name === "script") expect(result.scriptElements).toBe(1);
      expect(browser.contexts()).toHaveLength(before);
      receipts.push({ name, ...result });
    }
    expect(requests).toBe(0);
    return { cases: receipts, networkRequests: requests, contextsClosed: true };
  } finally {
    await new Promise((done, reject) =>
      server.close((error) => (error ? reject(error) : done())),
    );
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    console.log(JSON.stringify(await verifyInertReference(browser), null, 2));
  } finally {
    await browser.close();
  }
}
