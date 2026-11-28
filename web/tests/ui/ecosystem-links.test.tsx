import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  EcosystemContextForTests,
  PlannerLinks,
  SyncNotice,
} from "../../src/sync/Provider";
import type { EcosystemSnapshot } from "../../src/sync/cycle";
import type { NotesLibraryStore } from "../../src/library/contracts";
const accountId = "11111111-1111-4111-8111-111111111111";
const modalDescriptors = ["showModal", "close"].map(
  (name) =>
    [
      name,
      Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name),
    ] as const,
);
function controller() {
  let snapshot: EcosystemSnapshot = {
    status: "Sign in to sync",
    error: "Session expired",
    syncedAt: null,
    links: [],
    tasks: [{ id: "task", zone: "list:inbox", title: "Existing task" }],
  };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    syncNow: vi.fn(async () => {}),
    link: vi.fn(async () => {}),
    publish: (patch: Partial<EcosystemSnapshot>) => {
      snapshot = { ...snapshot, ...patch };
      listeners.forEach((listener) => listener());
    },
  };
}
beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});
afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
  vi.restoreAllMocks();
  for (const [name, descriptor] of modalDescriptors) {
    if (descriptor)
      Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});
it("blocks opening and submitting the task picker when the workspace becomes read-only", async () => {
  const value = controller();
  const view = render(
    <EcosystemContextForTests.Provider value={value}>
      <PlannerLinks noteId="n" />
    </EcosystemContextForTests.Provider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Link a task" }));
  expect(screen.getByRole("dialog", { name: "Link a task" })).toBeVisible();
  view.rerender(
    <EcosystemContextForTests.Provider value={value}>
      <PlannerLinks noteId="n" readOnly />
    </EcosystemContextForTests.Provider>,
  );
  expect(screen.getByRole("button", { name: "Link a task" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Existing task" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Existing task" }));
  expect(value.link).not.toHaveBeenCalled();
});
it("retains the note intent through sign-in, reports unavailable notes, and opens them on a later pass", async () => {
  history.replaceState(
    null,
    "",
    `/?orbynNote=missing&orbynAccount=${accountId}`,
  );
  const value = controller();
  let present = false;
  const store = {
    library: {
      read: async () => ({
        mode: "ready",
        snapshot: {
          token: { epoch: "22222222-2222-4222-8222-222222222222" },
          notes: present ? [{ id: "missing" }] : [],
        },
      }),
    },
  } as unknown as NotesLibraryStore;
  render(
    <EcosystemContextForTests.Provider value={value}>
      <SyncNotice
        store={store}
        identity={{
          accountId,
          deviceId: "device",
          email: "test@example.test",
          deviceState: "trusted",
        }}
      />
    </EcosystemContextForTests.Provider>,
  );
  const href = new URL(
    screen.getByRole("link", { name: "Sign in to sync" }).getAttribute("href")!,
  );
  expect(href.searchParams.get("orbynNote")).toBe("missing");
  expect(href.searchParams.get("orbynAccount")).toBe(accountId);
  act(() =>
    value.publish({
      status: "Synced",
      error: null,
      syncedAt: "2026-11-28T00:00:00Z",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This linked note isn’t available",
  );
  expect(location.search).toContain("orbynNote=missing");
  present = true;
  act(() => value.publish({ syncedAt: "2026-11-28T00:01:00Z" }));
  await waitFor(() => expect(location.hash).toMatch(/^#note\/v1\//));
  expect(
    screen.queryByText(/This linked note isn’t available/),
  ).not.toBeInTheDocument();
});
