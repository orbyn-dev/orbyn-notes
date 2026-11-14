import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/settings-beta-navigation";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5197";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
const page = await context.newPage(),
  errors = [],
  measurements = [];
page.on("pageerror", (error) => errors.push(error.message));
const categories = [
  "General",
  "Editor",
  "Sync Planned",
  "Study",
  "Journal",
  "Connected apps Planned",
  "Data and export",
];
const heading = (name) => name.replace(" Planned", "");
const button = (root, name) => root.getByRole("button", { name, exact: true });
async function geometry(locator) {
  return locator.evaluate((e) => {
    const r = e.getBoundingClientRect(),
      s = getComputedStyle(e);
    return {
      width: r.width,
      height: r.height,
      fontSize: s.fontSize,
      weight: s.fontWeight,
      color: s.color,
      background: s.backgroundColor,
    };
  });
}
try {
  // Production SettingsView/Dialog with long synthetic account text and actual preferences.
  await page.goto(`${base}/tests/integration/settings-shell-browser.html`);
  for (const theme of ["Light", "Dark", "Dim"]) {
    await button(page, theme).click();
    for (const width of [1160, 390, 899]) {
      await page.setViewportSize({ width, height: 850 });
      for (const category of categories) {
        const nav = page.getByRole("navigation", { name: "Settings sections" });
        const target = button(nav, category);
        await target.focus();
        await page.keyboard.press("Enter");
        await expect(target).toHaveAttribute("aria-current", "page");
        await expect(
          page.getByRole("heading", { name: heading(category), exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await expect(button(page, "Done")).toBeVisible();
        measurements.push({
          theme,
          viewport: await page.evaluate(() => ({
            width: innerWidth,
            height: innerHeight,
          })),
          category,
          heading: await geometry(page.locator(".settings-heading h3")),
          nav: await geometry(target),
        });
        if (width !== 899)
          await page.screenshot({
            path: `${output}/${theme}-${width}-${heading(category).replaceAll(" ", "-")}.png`,
            animations: "disabled",
          });
      }
    }
    await button(page.getByRole("navigation"), "General").click();
  }
  if (process.env.NOTES_DESIGN_HTML) {
    const reference = await context.newPage();
    await reference.setContent(
      await readFile(process.env.NOTES_DESIGN_HTML, "utf8"),
    );
    for (const theme of ["light", "dark", "dim"]) {
      await reference.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      for (const id of ["general", "sync", "journal", "apps", "data"]) {
        const frame = reference.locator(`#settings-${id}`);
        measurements.push({
          reference: id,
          theme,
          heading: await geometry(frame.locator(".ph h3")),
          nav: await geometry(frame.locator(".side .nav").nth(1)),
          row: await geometry(frame.locator(".srow").first()),
        });
      }
    }
    await reference.close();
  }
  // Existing disposable encrypted App fixture; no account backend or human profile.
  await page.setViewportSize({ width: 1160, height: 850 });
  await page.goto(`${base}/tests/integration/study-settings-browser.html`);
  await expect(
    page.getByRole("heading", { name: "All notes", exact: true }),
  ).toBeVisible();
  const settings = () =>
    page.getByRole("dialog", { name: "Settings", exact: true });
  async function open(section) {
    await button(page, "Settings").click();
    await button(settings().getByRole("navigation"), section).click();
    return settings();
  }
  await open("General");
  await button(settings(), "Done").click();
  await expect(button(page, "Settings")).toBeFocused();
  await open("Journal");
  await page.evaluate(async () => {
    const { registerCloseGuard } = await import("/src/desktop/closeGuard.ts");
    window.releaseSettingsGuard = registerCloseGuard(() => false);
  });
  await button(settings(), "Open Journal").click();
  await expect(settings()).toBeVisible();
  await expect(page.locator(".notice")).toBeVisible();
  await page.evaluate(() => window.releaseSettingsGuard());
  await button(settings(), "Open Journal").click();
  await expect(settings()).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "Set a Journal passphrase",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByLabel("Passphrase", { exact: true })).toBeFocused();
  const secret = "Synthetic settings journal passphrase";
  await page.getByLabel("Passphrase", { exact: true }).fill(secret);
  await page.getByLabel("Confirm passphrase", { exact: true }).fill(secret);
  await button(page, "Lock Journal").click();
  await expect(button(page, "Journal menu")).toBeVisible();
  await open("Journal");
  await expect(settings().locator('input[type="password"]')).toHaveCount(0);
  await expect(settings().getByRole("textbox")).toHaveCount(0);
  await button(settings(), "Open Journal").click();
  await expect(button(page, "Journal menu")).toBeVisible();
  await expect(button(page.locator("aside"), "Journal")).toBeFocused();
  await open("Data and export");
  await button(settings(), "Export all notes").click();
  const exp = page.getByRole("dialog", {
    name: "Export Markdown",
    exact: true,
  });
  await expect(exp).toBeVisible();
  await button(exp, "Cancel").click();
  await button(settings(), "Erase this browser").click();
  const erase = page.getByRole("dialog", {
    name: "Erase notes from this browser?",
    exact: true,
  });
  await expect(button(erase, "Erase notes")).toBeDisabled();
  await button(erase, "Cancel").click();
  await button(settings(), "Open Journal to export").click();
  await expect(button(page, "Journal menu")).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Export Journal", exact: true }),
  ).toHaveCount(0);
  await button(page, "Journal menu").click();
  await page
    .getByRole("menuitem", { name: "Lock Journal", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Journal is locked", exact: true }),
  ).toBeVisible();
  await open("Data and export");
  await button(settings(), "Open Journal to export").click();
  await expect(
    page.getByRole("heading", { name: "Journal is locked", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Passphrase", { exact: true })).toHaveValue("");
  // A dirty Study pane must retain its form before moving to the Journal gateway.
  await open("Study");
  await settings()
    .getByRole("textbox", { name: "New cards per day", exact: true })
    .fill("9");
  await button(settings().getByRole("navigation"), "Journal").click();
  const confirm = page.getByRole("dialog", {
    name: "Unsaved Study changes",
    exact: true,
  });
  await button(confirm, "Keep editing").click();
  await expect(
    settings().getByRole("textbox", { name: "New cards per day", exact: true }),
  ).toHaveValue("9");
  await button(settings().getByRole("navigation"), "Journal").click();
  await button(confirm, "Discard and continue").click();
  await expect(button(settings(), "Open Journal")).toBeVisible();
  await button(settings(), "Open Journal").click();
  await expect(
    page.getByRole("heading", { name: "Journal is locked", exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 850 });
  await button(page, "Open navigation").click();
  await open("Journal");
  await page.screenshot({
    path: `${output}/real-narrow-journal-gateway.png`,
    animations: "disabled",
  });
  await button(settings(), "Open Journal").click();
  await expect(settings()).toHaveCount(0);
  await expect(button(page, "Open navigation")).toBeFocused();
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify({ measurements, errors }, null, 2),
  );
  console.log(
    "PASS: seven categories × three themes × three widths; real encrypted Journal locked/unlocked gateways; guards, focus and export/erase cancellation",
  );
} finally {
  await browser.close();
}
