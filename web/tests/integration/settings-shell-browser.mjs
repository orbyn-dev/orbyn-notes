import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/settings-shell";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
const page = await context.newPage(),
  errors = [],
  measurements = [];
page.on("pageerror", (e) => errors.push(e.message));
const nav = (name) =>
  page.getByRole("navigation").getByRole("button", { name, exact: true });
const button = (name) => page.getByRole("button", { name, exact: true });
async function measure(locator) {
  return locator.evaluate((e) => {
    const s = getComputedStyle(e),
      r = e.getBoundingClientRect();
    return {
      width: r.width,
      height: r.height,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      letterSpacing: s.letterSpacing,
      padding: s.padding,
      gap: s.gap,
      color: s.color,
      background: s.backgroundColor,
    };
  });
}
try {
  await page.goto(
    `${process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5195"}/tests/integration/settings-shell-browser.html`,
  );
  for (const theme of ["Light", "Dark", "Dim"]) {
    await button(theme).click();
    await page
      .getByRole("group", { name: "Motion" })
      .getByRole("button", { name: "Reduced" })
      .click();
    expect(await page.evaluate(() => localStorage.getItem("notes.theme"))).toBe(
      theme.toLowerCase(),
    );
    const heading = await measure(page.locator(".settings-heading h3"));
    expect(heading.fontSize).toBe("22px");
    expect(heading.fontWeight).toBe("500");
    expect(heading.height).toBeCloseTo(31.89, 1);
    expect((await measure(page.locator(".settings-nav"))).width).toBe(210);
    expect((await measure(nav("General"))).height).toBe(29);
    const segment = await measure(
      page
        .getByRole("group", { name: "Appearance" })
        .getByRole("button")
        .first(),
    );
    expect(segment.height).toBe(24);
    expect(segment.fontSize).toBe("12px");
    for (const section of ["General", "Editor", "Data and export"]) {
      await nav(section).click();
      await expect(nav(section)).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByRole("heading", { name: section, exact: true }),
      ).toBeVisible();
      const rows = await page.locator(".settings-row").evaluateAll((rows) =>
        rows.map((r) => ({
          height: r.getBoundingClientRect().height,
          top: getComputedStyle(r).borderTopWidth,
          bottom: getComputedStyle(r).borderBottomWidth,
        })),
      );
      expect(rows.every((r) => r.height >= 52 && r.top === "1px")).toBe(true);
      expect(rows.at(-1).bottom).toBe("1px");
      measurements.push({ theme, section, heading, segment, rows });
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${theme}-${section.replaceAll(" ", "-")}.png`,
      });
    }
    await nav("General").click();
  }
  for (const [name, value] of [
    ["Set up Notes", "setup"],
    ["Sign out", "signout"],
    ["Done", "done"],
  ]) {
    await button(name).click();
    await expect(page.getByLabel("Fixture callback")).toHaveText(value);
  }
  await nav("Editor").click();
  const markdown = page.getByRole("checkbox", {
    name: "Turn Markdown into formatting while typing",
  });
  const size = await measure(markdown);
  expect(size.width).toBe(30);
  expect(size.height).toBe(18);
  await markdown.focus();
  await page.keyboard.press("Space");
  await expect(markdown).not.toBeChecked();
  expect(
    await markdown.evaluate((e) => getComputedStyle(e).outlineStyle),
  ).not.toBe("none");
  await page.screenshot({
    animations: "disabled",
    path: `${output}/keyboard-focus.png`,
  });
  await page.getByRole("checkbox", { name: "Check spelling" }).uncheck();
  await button("Large").click();
  await button("Wide").click();
  await expect(
    page.getByRole("checkbox", { name: "Show Linked from beside notes" }),
  ).toBeDisabled();
  await expect(page.getByText("Orbyn Planner · Planned")).toBeVisible();
  await page.reload();
  await nav("Editor").click();
  await expect(
    page.getByRole("checkbox", {
      name: "Turn Markdown into formatting while typing",
    }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Check spelling" }),
  ).not.toBeChecked();
  await expect(button("Large")).toHaveAttribute("aria-pressed", "true");
  await expect(button("Wide")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => localStorage.getItem("notes.motion"))).toBe(
    "reduced",
  );
  for (const width of [390, 899]) {
    await page.setViewportSize({ width, height: 850 });
    for (const section of ["General", "Editor", "Data and export", "Study"]) {
      await nav(section).click();
      await expect(nav(section)).toHaveAttribute("aria-current", "page");
      await expect(
        page.getByRole("heading", { name: section, exact: true }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        animations: "disabled",
        path: `${output}/${width}-${section.replaceAll(" ", "-")}.png`,
      });
    }
  }
  await nav("Data and export").click();
  for (const [name, value] of [
    ["Export all notes", "export"],
    ["Erase this browser", "erase"],
  ]) {
    await button(name).click();
    await expect(page.getByLabel("Fixture callback")).toHaveText(value);
  }
  if (process.env.NOTES_DESIGN_HTML) {
    const ref = await context.newPage();
    await ref.setContent(await readFile(process.env.NOTES_DESIGN_HTML, "utf8"));
    for (const id of ["settings-general", "settings-editor", "settings-data"]) {
      const frame = ref.locator(`#${id}`);
      measurements.push({
        reference: id,
        heading: await measure(frame.locator(".ph h3")),
        nav: await measure(frame.locator(".side .nav").nth(1)),
        row: await measure(frame.locator(".srow").first()),
      });
      await frame
        .locator(".app")
        .screenshot({ path: `${output}/reference-${id}.png` });
    }
  }
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify(
      {
        viewport: await page.evaluate(() => ({
          width: innerWidth,
          height: innerHeight,
          dpr: devicePixelRatio,
        })),
        measurements,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS: themes, geometry, keyboard focus, preferences across reload, callbacks and narrow containment",
  );
} finally {
  await browser.close();
}
