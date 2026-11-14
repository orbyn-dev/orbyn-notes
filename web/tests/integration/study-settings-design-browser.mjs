import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";

// Optional local source readback; never store the private design artifact in Git.
const referencePath = process.env.NOTES_DESIGN_REFERENCE;
const output =
  process.env.NOTES_UI_OUTPUT ?? "test-results/study-settings-design";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (error) => pageErrors.push(error.message));
const measurements = [];
const expectedLabels = [
  "New cards per day",
  "Reviews per day",
  "Daily reminder",
  "Day starts at",
  "Show next review on answer buttons",
  "Show streak",
  "Add a daily Study task to Planner",
  "Suggest cards when I finish a note",
  "Let my agent make cards",
];
try {
  let reference;
  if (referencePath) {
    reference = await context.newPage();
    await reference.route("https://**", (route) => route.abort());
    await reference.setContent(await readFile(referencePath, "utf8"));
  }
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5196"}/tests/integration/study-settings-browser.html`,
  );
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
  await dialog.getByRole("button", { name: "Study", exact: true }).click();
  const field = dialog.getByRole("textbox", {
    name: "New cards per day",
    exact: true,
  });
  await expect(field).toHaveValue("10");
  const before = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  await expect(dialog.locator(".study-settings-row b")).toHaveText(
    expectedLabels,
  );
  for (const theme of ["light", "dark", "dim"]) {
    await page.evaluate(
      (value) => (document.documentElement.dataset.theme = value),
      theme,
    );
    let source;
    if (reference) {
      await reference
        .locator("#settings-study .app")
        .evaluate((el, value) => (el.dataset.th = value), theme);
      source = await reference.locator("#settings-study").evaluate((el) => {
        const row = el.querySelector(".srow");
        const css = (selector) => getComputedStyle(el.querySelector(selector));
        return {
          labelWeight: css(".lab2 b").fontWeight,
          labelColor: css(".lab2 b").color,
          helperColor: css(".lab2 small").color,
          labelSize: css(".lab2 b").fontSize,
          rowBorder: getComputedStyle(row).borderTopColor,
          fieldBackground: css(".srow .sel").backgroundColor,
          fieldColor: css(".srow .sel").color,
          labelGap: css(".lab2").gap,
          rowMinHeight: getComputedStyle(row).minHeight,
          rowPadding: getComputedStyle(row).padding,
          fieldWidth: css(".srow .sel").width,
          fieldHeight: css(".srow .sel").height,
          fieldRadius: css(".srow .sel").borderRadius,
          switchWidth: css(".tgl").width,
          switchHeight: css(".tgl").height,
        };
      });
    }
    for (const width of [1160, 640, 390, 320]) {
      await page.setViewportSize({ width, height: 850 });
      const actual = await dialog.locator(".study-settings").evaluate((el) => {
        const css = (selector) => getComputedStyle(el.querySelector(selector));
        const rows = [...el.querySelectorAll(".study-settings-row")];
        return {
          viewport: innerWidth,
          formGap: css("form").gap,
          labelWeight: css(".study-settings-row b").fontWeight,
          labelColor: css(".study-settings-row b").color,
          helperColor: css(".study-settings-row small").color,
          labelSize: css(".study-settings-row b").fontSize,
          rowBorder: css(".study-settings-row").borderTopColor,
          fieldBackground: css('input[type="text"]').backgroundColor,
          fieldColor: css('input[type="text"]').color,
          labelGap: css(".study-settings-row > label").gap,
          rowMinHeight: css(".study-settings-row").minHeight,
          rowPadding: css(".study-settings-row").padding,
          fieldWidth: css('input[type="text"]').width,
          fieldHeight: css('input[type="text"]').height,
          fieldRadius: css('input[type="text"]').borderRadius,
          switchWidth: css('[role="switch"]').width,
          switchHeight: css('[role="switch"]').height,
          rowGaps: rows
            .slice(1)
            .map(
              (row, i) =>
                row.getBoundingClientRect().top -
                rows[i].getBoundingClientRect().bottom,
            ),
          overflow: el.scrollWidth > el.clientWidth,
        };
      });
      expect(actual.viewport).toBe(width);
      expect(actual.formGap).toBe("0px");
      expect(actual.rowGaps.every((gap) => Math.abs(gap) < 0.1)).toBe(true);
      expect(actual.overflow).toBe(false);
      expect(actual).toMatchObject(
        source ?? {
          labelWeight: "400",
          labelGap: "2px",
          rowMinHeight: "52px",
          rowPadding: "8px 0px",
          fieldWidth: "100px",
          fieldHeight: "32px",
          fieldRadius: "8px",
          switchWidth: "30px",
          switchHeight: "18px",
        },
      );
      measurements.push({ theme, width, source, actual });
      await field.scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
    }
  }
  await field.focus();
  await expect(field).toBeFocused();
  expect(
    await field.evaluate((el) => getComputedStyle(el).outlineStyle),
  ).not.toBe("none");
  const toggle = dialog.getByRole("switch", {
    name: "Show streak",
    exact: true,
  });
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).not.toBeChecked();
  await expect(
    dialog.getByText("Unsaved changes", { exact: true }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Discard Study changes?", exact: true })
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(toggle).toBeChecked();
  // Synthetic long copy tests layout only; it never changes stored preferences.
  await dialog.locator(".study-settings-row small").evaluateAll((nodes) => {
    for (const node of nodes)
      node.textContent += " A-long-synthetic-study-setting-description".repeat(
        6,
      );
  });
  for (const width of [320, 390, 640, 1160]) {
    await page.setViewportSize({ width, height: 850 });
    expect(
      await dialog
        .locator(".study-settings")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await field.scrollIntoViewIfNeeded();
    await expect(field).toBeInViewport();
    await page.screenshot({ path: `${output}/long-copy-${width}.png` });
  }
  const after = await page.evaluate(() =>
    window.__studySettingsFixture.metadata(),
  );
  expect(after.preferences).toEqual(before.preferences);
  expect(after.cards).toEqual(before.cards);
  expect(after.events).toEqual(before.events);
  expect(pageErrors).toEqual([]);
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify(
      {
        measurements,
        pageErrors,
        keyboardCancel: "passed",
        longCopy: "passed",
      },
      null,
      2,
    ),
  );
  console.log(
    "Study settings source measurements and keyboard/long-copy checks passed",
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
