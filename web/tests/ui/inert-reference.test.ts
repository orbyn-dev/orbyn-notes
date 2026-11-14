import { expect, it, vi } from "vitest";
import type { Browser, Route } from "@playwright/test";
import { withInertReferencePage } from "../integration/inert-reference";

function fixture() {
  const page = {
    setContent: vi.fn(async (_html: string) => {}),
    emulateMedia: vi.fn(async () => {}),
  };
  const context = {
    route: vi.fn(
      async (
        _pattern: string,
        _handler: (route: Pick<Route, "abort">) => Promise<void>,
      ) => {},
    ),
    newPage: vi.fn(async () => page),
    close: vi.fn(async () => {}),
  };
  const browser = { newContext: vi.fn(async () => context) };
  return {
    page,
    context,
    browser,
    typedBrowser: browser as unknown as Browser,
  };
}
it("isolates raw reference HTML with script, network and service-worker execution disabled", async () => {
  const { page, context, browser, typedBrowser } = fixture();
  const html =
    '<style>#probe{color:rgb(12,34,56)}</style><script>unsafe()</ScRiPt ><button onclick="unsafe()">Probe</button>';
  const inspect = vi.fn(async () => ({ color: "rgb(12, 34, 56)" }));
  expect(await withInertReferencePage(typedBrowser, html, inspect)).toEqual({
    color: "rgb(12, 34, 56)",
  });
  expect(browser.newContext).toHaveBeenCalledExactlyOnceWith({
    javaScriptEnabled: false,
    serviceWorkers: "block",
    offline: true,
    acceptDownloads: false,
  });
  expect(context.route).toHaveBeenCalledBefore(context.newPage);
  const abort = vi.fn(async () => {});
  await context.route.mock.calls[0]![1]({ abort });
  expect(abort).toHaveBeenCalledExactlyOnceWith("blockedbyclient");
  expect(page.setContent).toHaveBeenCalledExactlyOnceWith(html);
  expect(inspect).toHaveBeenCalledExactlyOnceWith(page);
  expect(context.close).toHaveBeenCalledOnce();
});
it("closes only the reference context when inspection fails", async () => {
  const { context, typedBrowser } = fixture();
  await expect(
    withInertReferencePage(typedBrowser, "<p>Reference</p>", async () => {
      throw Error("inspection failed");
    }),
  ).rejects.toThrow("inspection failed");
  expect(context.close).toHaveBeenCalledOnce();
});
it("closes the reference context when content loading fails", async () => {
  const { page, context, typedBrowser } = fixture();
  page.setContent.mockRejectedValueOnce(Error("load failed"));
  const inspect = vi.fn();
  await expect(
    withInertReferencePage(typedBrowser, "<p>Reference</p>", inspect),
  ).rejects.toThrow("load failed");
  expect(inspect).not.toHaveBeenCalled();
  expect(context.close).toHaveBeenCalledOnce();
});
