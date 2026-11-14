import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { Workspace } from "../../src/ui/Workspace";
import {
  registerCloseGuard,
  trackOperation,
} from "../../src/desktop/closeGuard";
import type { NotesStore } from "../../src/domain/contracts";

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
const identity = {
  accountId: "synthetic-settings",
  deviceId: "synthetic-device",
  email: "settings@example.invalid",
  deviceState: "trusted" as const,
};
function store() {
  return {
    list: vi.fn(async () => []),
    subscribe: () => () => {},
    erase: vi.fn(),
  } as unknown as NotesStore;
}
async function mount() {
  const notes = store();
  const props = {
    store: notes,
    session: identity,
    onSignOut: vi.fn(async () => {}),
  };
  const view = render(<Workspace {...props} />);
  const trigger = await screen.findByRole("button", {
    name: "Settings",
  });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = screen.getByRole("dialog", { name: "Settings" });
  return { view, props, trigger, dialog };
}
it("exposes seven ordered categories and truthful selectable Planned panes", async () => {
  const { dialog } = await mount();
  const nav = within(dialog).getByRole("navigation");
  expect(
    within(nav)
      .getAllByRole("button")
      .map((b) => b.textContent),
  ).toEqual([
    "General",
    "Editor",
    "Sync Planned",
    "Study",
    "Journal",
    "Connected apps Planned",
    "Data and export",
  ]);
  expect(within(dialog).getByText("English")).toBeVisible();
  expect(within(dialog).getByText("More languages · Planned")).toBeVisible();
  for (const [name, copy] of [
    ["Sync Planned", "Notes stay on this device in this beta."],
    [
      "Connected apps Planned",
      "Connections to other apps and browser extensions aren’t available in this beta.",
    ],
  ] as const) {
    const button = within(nav).getByRole("button", { name });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-current", "page");
    expect(within(dialog).getByText(copy)).toBeVisible();
  }
});
for (const [section, action] of [
  ["Journal", "Open Journal"],
  ["Data and export", "Open Journal to export"],
]) {
  it(`routes ${section} through the workspace guard and focuses Journal after dialog cleanup`, async () => {
    const { dialog } = await mount();
    fireEvent.click(within(dialog).getByRole("button", { name: section }));
    const release = registerCloseGuard(() => false);
    try {
      fireEvent.click(within(dialog).getByRole("button", { name: action }));
      expect(dialog).toBeInTheDocument();
      expect(
        screen.getByText(
          "Finish or discard your unsaved changes before leaving.",
        ),
      ).toBeVisible();
    } finally {
      release();
    }
    fireEvent.click(within(dialog).getByRole("button", { name: action }));
    expect(dialog).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Journal" })).toHaveFocus();
    expect(
      screen.queryByRole("dialog", { name: /export/i }),
    ).not.toBeInTheDocument();
  });
}
it("retains Settings while an operation is working", async () => {
  const { dialog } = await mount();
  fireEvent.click(within(dialog).getByRole("button", { name: "Journal" }));
  let finish!: () => void;
  const pending = trackOperation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Open Journal" }),
    );
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByText(
        "Notes is still working. Wait for it to finish before leaving.",
      ),
    ).toBeVisible();
  } finally {
    finish();
    await pending;
  }
});
it("keeps private forms and stored Journal content out of global Settings", async () => {
  const { dialog } = await mount();
  fireEvent.click(within(dialog).getByRole("button", { name: "Journal" }));
  for (const fact of [
    "A separate passphrase",
    "1 minute away",
    "Open Journal to manage prompts and habits.",
    "In Journal, choose Journal settings from its menu.",
  ])
    expect(within(dialog).getByText(fact)).toBeVisible();
  expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
  expect(dialog.querySelector('input[type="password"]')).toBeNull();
  expect(within(dialog).queryByRole("checkbox")).not.toBeInTheDocument();
});
for (const replacement of ["account", "device", "store"] as const) {
  it(`does not carry a pending focus handoff into a replacement ${replacement}`, async () => {
    const { dialog, view, props } = await mount();
    fireEvent.click(within(dialog).getByRole("button", { name: "Journal" }));
    const journal = within(document.querySelector("aside")!).getByRole(
      "button",
      { name: "Journal" },
    );
    const focus = vi.spyOn(journal, "focus");
    act(() => {
      within(dialog).getByRole("button", { name: "Open Journal" }).click();
      view.rerender(
        <Workspace
          {...props}
          store={replacement === "store" ? store() : props.store}
          session={{
            ...identity,
            accountId:
              replacement === "account" ? "replacement" : identity.accountId,
            deviceId:
              replacement === "device" ? "replacement" : identity.deviceId,
          }}
        />,
      );
    });
    expect(focus).not.toHaveBeenCalled();
  });
}
