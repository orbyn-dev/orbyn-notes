import { chromium, expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const output = process.env.NOTES_UI_OUTPUT ?? "test-results/settings-motion";
const base = process.env.NOTES_PREVIEW_URL ?? "http://127.0.0.1:5198";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1160, height: 850 },
});
const page = await context.newPage(),
  errors = [],
  measurements = [];
page.on("pageerror", (error) => errors.push(error.message));
const nav = (name) =>
  page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name, exact: true });
const stable = (section) =>
  expect(
    page.locator(`.settings-motion-pane[data-section="${section}"]`),
  ).toHaveAttribute("data-phase", "stable");
const choose = async (name, section = name.toLowerCase()) => {
  await nav(name).click();
  await stable(section);
};
const group = (name, value) =>
  page
    .getByRole("group", { name, exact: true })
    .getByRole("button", { name: value, exact: true });
async function animations() {
  return page.evaluate(() =>
    document.getAnimations().map((animation) => ({
      target: animation.effect.target?.className,
      section: animation.effect.target?.dataset.section,
      phase: animation.effect.target?.dataset.phase,
      timing: animation.effect.getTiming(),
      frames: animation.effect.getKeyframes(),
      property: animation.transitionProperty,
    })),
  );
}
try {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${base}/tests/integration/settings-shell-browser.html`);
  await group("Motion", "On").click();
  await expect(page.locator(".settings-layout")).toHaveAttribute(
    "data-settings-motion",
    "full",
  );
  await nav("Editor").click();
  const full = await animations();
  measurements.push({ case: "explicit On with OS Reduce", animations: full });
  const entry = full.find((run) => run.phase === "incoming");
  expect(entry.timing).toMatchObject({
    duration: 240,
    delay: 60,
    easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  });
  expect(entry.frames.map((frame) => frame.transform)).toEqual([
    "translateY(6px)",
    "translateY(0px)",
  ]);
  expect(full.find((run) => run.phase === "outgoing").timing).toMatchObject({
    duration: 170,
    delay: 0,
  });
  expect(
    full.find(
      (run) =>
        run.target === "settings-indicator" && run.property === "transform",
    ).timing.duration,
  ).toBe(200);
  await expect(page.locator('[data-phase="outgoing"]')).toHaveAttribute(
    "inert",
    "",
  );
  const isolation = await page.evaluate(() => {
    const outgoing = document.querySelector('[data-phase="outgoing"] button');
    outgoing.focus();
    outgoing.click();
    return {
      focus: document.activeElement.dataset.settingsSection,
      action: document.querySelector("output").textContent,
    };
  });
  expect(isolation).toEqual({ focus: "editor", action: "none" });
  measurements.push({
    case: "outgoing native focus/click isolation",
    ...isolation,
  });
  // Hold the actual production animations for deterministic intermediate screenshots and numeric samples.
  const samples = [];
  for (const time of [0, 60, 120, 180, 240]) {
    samples.push(
      await page.evaluate((time) => {
        const pane = document.querySelector('[data-phase="incoming"]');
        const run = pane?.getAnimations()[0];
        if (!run) return null;
        run.pause();
        run.currentTime = time;
        const style = getComputedStyle(pane);
        return {
          time,
          opacity: Number(style.opacity),
          y: new DOMMatrixReadOnly(style.transform).m42,
        };
      }, time),
    );
    await page.screenshot({ path: `${output}/pane-${time}.png` });
  }
  measurements.push({ case: "pane samples", samples });
  expect(samples[0].opacity).toBe(0);
  expect(samples[0].y).toBe(6);
  expect(samples[3].opacity).toBeGreaterThan(0.5);
  // The presentation-only fallback also restores usability if a completion never arrives.
  await stable("editor");
  const toggle = page.getByRole("checkbox", {
    name: "Check spelling",
    exact: true,
  });
  const wasChecked = await toggle.isChecked();
  await toggle.click();
  const toggleRuns = await animations();
  measurements.push({ case: "toggle", animations: toggleRuns });
  expect(
    toggleRuns.some(
      (run) => run.property === "transform" && run.timing.duration === 150,
    ),
  ).toBe(true);
  await expect
    .poll(() =>
      toggle.evaluate(
        (element) =>
          new DOMMatrixReadOnly(getComputedStyle(element, "::after").transform)
            .m41,
      ),
    )
    .toBe(wasChecked ? 0 : 12);
  const switchGeometry = await toggle.evaluate((element) => {
    const rect = element.getBoundingClientRect(),
      knob = getComputedStyle(element, "::after");
    return {
      width: rect.width,
      height: rect.height,
      knob: knob.width,
      left: knob.left,
      travel: new DOMMatrixReadOnly(knob.transform).m41,
    };
  });
  expect(switchGeometry).toMatchObject({
    width: 30,
    height: 18,
    knob: "14px",
    left: "2px",
  });
  measurements.push({ case: "Notes switch geometry", ...switchGeometry });
  await group("Text size", "Large").click();
  const segments = await animations();
  measurements.push({ case: "segmented", animations: segments });
  expect(
    segments.some(
      (run) =>
        run.target === "settings-indicator" && run.timing.duration === 200,
    ),
  ).toBe(true);
  await choose("General");
  await group("Motion", "System").click();
  await expect(page.locator(".settings-layout")).toHaveAttribute(
    "data-settings-motion",
    "reduced",
  );
  await nav("Journal").click();
  const reduced = await animations();
  measurements.push({ case: "System OS Reduce", animations: reduced });
  const fade = reduced.find((run) => run.phase === "incoming");
  expect(fade.timing).toMatchObject({
    duration: 150,
    delay: 0,
    easing: "cubic-bezier(0.4, 0, 0.2, 1)",
  });
  expect(fade.frames.every((frame) => frame.transform === "none")).toBe(true);
  expect(
    reduced.some(
      (run) =>
        run.target === "settings-indicator" && run.property === "transform",
    ),
  ).toBe(false);
  expect(
    await nav("Journal").evaluate((element) => ({
      property: getComputedStyle(element).transitionProperty,
      duration: getComputedStyle(element).transitionDuration,
    })),
  ).toEqual({ property: "color", duration: "0.15s" });
  // Policy change midflight settles before replay, then the System subscription follows the media query.
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await stable("journal");
  await expect(page.locator(".settings-motion-pane")).toHaveCount(1);
  await expect(page.locator(".settings-layout")).toHaveAttribute(
    "data-settings-motion",
    "full",
  );
  await choose("General");
  await group("Motion", "Reduced").click();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await choose("Editor");
  const reducedFeedback = await page.evaluate(() => {
    const style = (selector, pseudo) => {
      const s = getComputedStyle(document.querySelector(selector), pseudo);
      return {
        property: s.transitionProperty,
        duration: s.transitionDuration,
        easing: s.transitionTimingFunction,
      };
    };
    return {
      nav: style(".settings-nav button"),
      label: style(".settings-segments button"),
      track: style('.settings-row input[type="checkbox"]'),
      knob: style('.settings-row input[type="checkbox"]', "::after"),
    };
  });
  for (const key of ["nav", "label"])
    expect(reducedFeedback[key]).toMatchObject({
      property: "color",
      duration: "0.15s",
      easing: "cubic-bezier(0.4, 0, 0.2, 1)",
    });
  expect(reducedFeedback.track).toMatchObject({
    property: "background-color",
    duration: "0.15s",
  });
  expect(reducedFeedback.knob.duration).toBe("0s");
  measurements.push({
    case: "explicit Reduced color feedback",
    ...reducedFeedback,
  });
  await group("Text size", "Medium").click();
  expect(
    (await animations()).some(
      (run) => run.property === "color" && run.timing.duration === 150,
    ),
  ).toBe(true);
  await group("Text size", "Large").click();
  await toggle.click();
  expect(
    (await animations()).some(
      (run) =>
        run.property === "background-color" && run.timing.duration === 150,
    ),
  ).toBe(true);
  measurements.push({
    case: "explicit Reduced knob",
    duration: await toggle.evaluate(
      (element) => getComputedStyle(element, "::after").transitionDuration,
    ),
  });
  expect(
    await toggle.evaluate(
      (element) => getComputedStyle(element, "::after").transitionDuration,
    ),
  ).toBe("0s");
  await choose("General");
  for (const theme of ["Light", "Dark", "Dim"]) {
    await group("Appearance", theme).click();
    for (const width of [1160, 899, 390]) {
      await page.setViewportSize({ width, height: 850 });
      await choose("Connected apps Planned", "apps");
      const geometry = await page.evaluate(() => {
        const selected = document
          .querySelector('[aria-current="page"]')
          .getBoundingClientRect();
        const indicator = document
          .querySelector(".settings-nav .settings-indicator")
          .getBoundingClientRect();
        return {
          viewport: innerWidth,
          noOverflow: document.documentElement.scrollWidth <= innerWidth,
          deltaX: indicator.x - selected.x,
          deltaY: indicator.y - selected.y,
          width: indicator.width - selected.width,
          height: indicator.height - selected.height,
          theme: document.documentElement.dataset.theme,
        };
      });
      expect(geometry.noOverflow).toBe(true);
      for (const property of ["deltaX", "deltaY", "width", "height"])
        expect(Math.abs(geometry[property])).toBeLessThan(0.6);
      measurements.push({ case: "geometry", ...geometry });
      await page.screenshot({ path: `${output}/${theme}-${width}.png` });
      await choose("General");
    }
  }
  await page.reload();
  await expect(group("Appearance", "Dim")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(group("Motion", "Reduced")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await choose("Editor");
  await expect(group("Text size", "Large")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await toggle.isChecked()).toBe(wasChecked);
  // Full App + real encrypted local owner, fresh context and disposable synthetic identity.
  const real = await browser.newContext({
    viewport: { width: 1160, height: 850 },
  });
  const app = await real.newPage();
  app.on("pageerror", (error) => errors.push(error.message));
  await app.goto(`${base}/tests/integration/study-settings-browser.html`);
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = app.getByRole("dialog", { name: "Settings", exact: true });
  const realNav = (name) =>
    dialog.getByRole("navigation").getByRole("button", { name, exact: true });
  await dialog
    .getByRole("group", { name: "Motion", exact: true })
    .getByRole("button", { name: "Reduced", exact: true })
    .click();
  await realNav("Study").click();
  const field = dialog.getByRole("textbox", {
    name: "New cards per day",
    exact: true,
  });
  await expect(field).toHaveValue("10");
  expect(
    await dialog
      .getByRole("switch", { name: "Show streak", exact: true })
      .evaluate((element) => ({
        property: getComputedStyle(element).transitionProperty,
        duration: getComputedStyle(element).transitionDuration,
        knob: getComputedStyle(element, "::after").transitionDuration,
      })),
  ).toEqual({ property: "background-color", duration: "0.15s", knob: "0s" });
  await realNav("General").click();
  await dialog
    .getByRole("group", { name: "Motion", exact: true })
    .getByRole("button", { name: "On", exact: true })
    .click();
  await realNav("Study").click();
  await field.fill("9");
  await realNav("General").click();
  await expect(realNav("Study")).toHaveAttribute("aria-current", "page");
  await expect(dialog.locator('[data-phase="outgoing"]')).toHaveCount(0);
  const confirm = app.getByRole("dialog", {
    name: "Unsaved Study changes",
    exact: true,
  });
  await confirm
    .getByRole("button", { name: "Keep editing", exact: true })
    .click();
  await expect(field).toHaveValue("9");
  await realNav("General").click();
  await confirm
    .getByRole("button", { name: "Save and continue", exact: true })
    .click();
  await expect(realNav("General")).toHaveAttribute("aria-current", "page");
  expect(
    (await app.evaluate(() => window.__studySettingsFixture.metadata()))
      .preferences.newPerDay,
  ).toBe(9);
  // One browser task admits three changes before a delayed entry becomes visible.
  await app.evaluate(() => {
    for (const section of ["study", "general", "study"])
      document.querySelector(`[data-settings-section="${section}"]`).click();
  });
  await expect(dialog.locator("form")).toHaveCount(1);
  await expect(dialog.locator(".settings-motion-pane")).toHaveCount(1);
  await expect(field).toHaveValue("9");
  await field.fill("8");
  await realNav("Journal").click();
  await confirm
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  await expect(realNav("Journal")).toBeFocused();
  await dialog
    .getByRole("button", { name: "Open Journal", exact: true })
    .click();
  await expect(app.getByLabel("Passphrase", { exact: true })).toBeFocused();
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  await realNav("Study").click();
  await expect(field).toHaveValue("9");
  const doneReceipt = await app.evaluate(() => {
    document.querySelector('[data-settings-section="general"]').click();
    const available = !document
      .querySelector(".settings-motion-done")
      .closest("[inert]");
    document.querySelector(".settings-motion-done").click();
    return { available };
  });
  expect(doneReceipt.available).toBe(true);
  await expect(dialog).toHaveCount(0);
  await expect(
    app.getByRole("button", { name: "Settings", exact: true }),
  ).toBeFocused();
  await app.getByRole("button", { name: "Settings", exact: true }).click();
  await realNav("Study").click();
  await expect(field).toHaveValue("9");
  // Incoming and outgoing actions are inert; only navigation and Done admit actions during motion.
  await app.evaluate(() =>
    document.querySelector('[data-settings-section="general"]').click(),
  );
  const lockReceipt = await app.evaluate(() => {
    window.__studySettingsFixture.lock();
    return {
      panes: document.querySelectorAll(".settings-motion-pane").length,
      fields: document.querySelectorAll(
        ".study-settings input, .study-settings select",
      ).length,
      outgoing: document.querySelectorAll('[data-phase="outgoing"]').length,
      motion: [...document.querySelectorAll(".settings-motion-pane")].flatMap(
        (pane) => pane.getAnimations(),
      ).length,
    };
  });
  expect(lockReceipt.panes).toBeLessThanOrEqual(1);
  expect(lockReceipt.fields).toBe(0);
  expect(lockReceipt.outgoing).toBe(0);
  expect(lockReceipt.motion).toBe(0);
  await expect(dialog).toHaveCount(0);
  measurements.push({ case: "same-turn real lock", ...lockReceipt });
  await real.close();
  if (process.env.NOTES_MOTION_REFERENCE) {
    const reference = await context.newPage();
    await reference.emulateMedia({ reducedMotion: "no-preference" });
    await reference.setContent(
      (await readFile(process.env.NOTES_MOTION_REFERENCE, "utf8")).replace(
        /<script\b[^>]*>[\s\S]*?<\/script>/gi,
        "",
      ),
    );
    const values = await reference.evaluate(() => {
      const style = (selector, pseudo) => {
        const s = getComputedStyle(document.querySelector(selector), pseudo);
        return {
          duration: s.transitionDuration,
          property: s.transitionProperty,
          easing: s.transitionTimingFunction,
        };
      };
      return {
        highlight: style("#settings .sidehl .hlt"),
        pane: style("#settings .pg"),
        toggle: style("#toggle .mtg"),
        knob: style("#toggle .mtg", "::after"),
        segmented: style("#segmented .msg .th"),
      };
    });
    expect(values.highlight.duration).toBe("0.2s");
    expect(values.knob.duration).toBe("0.15s");
    expect(values.segmented.duration).toBe("0.2s");
    measurements.push({ case: "reference computed styles", ...values });
    await reference.close();
  }
  expect(errors).toEqual([]);
  await writeFile(
    `${output}/measurements.json`,
    JSON.stringify({ measurements, errors }, null, 2),
  );
  console.log(
    "PASS: source timings, interruption/policy, three themes × three widths, real preference reload, encrypted Study guard/save/discard, Journal focus and synchronous lock",
  );
} finally {
  await browser.close();
}
