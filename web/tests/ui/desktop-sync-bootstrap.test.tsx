import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const fixture = vi.hoisted(() => ({
  original: { library: {}, close: () => {} },
  sync: null as unknown,
  workspace: null as unknown,
}));
vi.mock("../../src/account", () => ({
  createAccountService: () => ({
    current: async () => ({
      accountId: "a",
      deviceId: "d",
      email: "test@example.test",
      deviceState: "trusted",
    }),
    close: () => {},
  }),
  subscribeLock: () => () => {},
}));
vi.mock("../../src/data", () => ({
  openNotesStore: async () => fixture.original,
}));
vi.mock("../../src/data/local", () => ({
  localModeSelected: () => false,
  selectLocalMode: () => {},
}));
vi.mock("../../src/desktop/window", () => ({ isDesktop: () => true }));
vi.mock("../../src/desktop/DesktopShell", () => ({
  DesktopShell: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../../src/desktop/capture", () => ({
  isQuickWindow: () => false,
  setCaptureScope: async () => {},
}));
vi.mock("../../src/links/useIncomingNoteLink", () => ({
  useIncomingNoteLink: () => ({
    state: null,
    revoke: () => {},
    register: () => {},
    hasPending: false,
  }),
}));
vi.mock("../../src/sync/Provider", () => ({
  EcosystemProvider: ({
    store,
    children,
  }: {
    store: unknown;
    children: ReactNode;
  }) => {
    fixture.sync = store;
    return children;
  },
}));
vi.mock("../../src/ui/Workspace", () => ({
  Workspace: ({ store }: { store: unknown }) => {
    fixture.workspace = store;
    return <p>Desktop workspace opened</p>;
  },
}));
import { App } from "../../src/App";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("keeps the registered store identity for sync while tracking desktop workspace operations", async () => {
  vi.stubEnv("VITE_ECOSYSTEM_SYNC", "1");
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  render(<App />);
  expect(await screen.findByText("Desktop workspace opened")).toBeVisible();
  expect(fixture.sync).toBe(fixture.original);
  expect(fixture.workspace).not.toBe(fixture.original);
});
