import { expect, it } from "vitest";
import { reconnectHref, plannerTaskHref } from "../../src/sync/appLinks";
it("preserves a Planner backlink target through Notes sign-in", () => {
  const url = new URL(
    reconnectHref(
      "https://example.test/notes/?orbynNote=n&orbynAccount=a#pending",
    ),
  );
  expect(url.pathname).toBe("/notes/");
  expect(url.searchParams.get("orbynNote")).toBe("n");
  expect(url.searchParams.get("orbynAccount")).toBe("a");
  expect(url.searchParams.get("connect")).toBe("1");
  expect(url.hash).toBe("#pending");
});
it("keeps the configured Planner app path and refuses untrusted destinations", () => {
  const href = plannerTaskHref(
    "https://example.test/planner/",
    "task",
    "account",
  );
  expect(new URL(href!).pathname).toBe("/planner/tasks");
  expect(new URL(href!).searchParams.get("orbynTask")).toBe("task");
  expect(
    plannerTaskHref("http://external.test/", "task", "account"),
  ).toBeNull();
  expect(
    plannerTaskHref("https://user:password@example.test/", "task", "account"),
  ).toBeNull();
});
