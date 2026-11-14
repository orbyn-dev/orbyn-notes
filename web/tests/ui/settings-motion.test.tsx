import { StrictMode, useLayoutEffect } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsView } from "../../src/ui/SettingsView";
import type { SettingsLeaveGuard } from "../../src/ui/studySettingsTypes";
import type { CollectionsStore } from "../../src/collections/contracts";

const study = vi.hoisted(() => ({
  registrations: [] as Array<(guard: SettingsLeaveGuard | null) => void>,
  admitted: true,
  pending: null as (() => void) | null,
}));
const lifetime = vi.hoisted(() => ({
  version: 0,
  locks: new Set<() => void>(),
  closes: new Set<() => void>(),
  epochs: new Set<() => void>(),
}));
vi.mock("../../src/collections/store", () => ({
  onCollectionsClose: (_: object, fn: () => void) => {
    lifetime.closes.add(fn);
    return () => lifetime.closes.delete(fn);
  },
  onCollectionsEpochChange: (_: object, fn: () => void) => {
    lifetime.epochs.add(fn);
    return () => lifetime.epochs.delete(fn);
  },
}));
vi.mock("../../src/account/session", () => ({
  lockVersion: () => lifetime.version,
  onLock: (fn: () => void) => {
    lifetime.locks.add(fn);
    return () => lifetime.locks.delete(fn);
  },
}));
vi.mock("../../src/ui/StudySettingsPanel", () => ({
  StudySettingsPanel: ({
    onGuardReady,
  }: {
    onGuardReady: (guard: SettingsLeaveGuard | null) => void;
  }) => {
    useLayoutEffect(() => {
      study.registrations.push(onGuardReady);
      onGuardReady({
        canClose: () => study.admitted,
        requestLeave: (next) => {
          if (study.admitted) next();
          else study.pending = next;
        },
      });
      return () => onGuardReady(null);
    }, [onGuardReady]);
    return (
      <form aria-label="Synthetic Study">
        <button>Study action</button>
      </form>
    );
  },
}));
type Run = {
  element: HTMLElement;
  frames: Keyframe[];
  options: KeyframeAnimationOptions;
  resolve: () => void;
  cancel: ReturnType<typeof vi.fn>;
};
let runs: Run[],
  reduced = false;
const changes = new Set<() => void>();
Object.defineProperty(HTMLElement.prototype, "animate", {
  configurable: true,
  writable: true,
  value: () => {},
});
beforeEach(() => {
  vi.useFakeTimers();
  runs = [];
  changes.clear();
  study.registrations = [];
  study.admitted = true;
  study.pending = null;
  lifetime.version = 0;
  lifetime.locks.clear();
  lifetime.closes.clear();
  lifetime.epochs.clear();
  vi.stubGlobal("matchMedia", () => ({
    get matches() {
      return reduced;
    },
    addEventListener: (_: string, fn: () => void) => changes.add(fn),
    removeEventListener: (_: string, fn: () => void) => changes.delete(fn),
  }));
  vi.spyOn(HTMLElement.prototype, "animate").mockImplementation(function (
    this: HTMLElement,
    frames,
    options,
  ) {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => {
      resolve = done;
    });
    const cancel = vi.fn();
    runs.push({
      element: this,
      frames: frames as Keyframe[],
      options: options as KeyframeAnimationOptions,
      resolve,
      cancel,
    });
    return { finished, cancel } as unknown as Animation;
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  reduced = false;
});
const preferences = (motion = "on") => ({
  theme: "light" as const,
  motion,
  setMotion: vi.fn(),
  setTheme: vi.fn(),
});
function mount(motion = "on") {
  const props = {
    email: "synthetic@example.invalid",
    preferences: preferences(motion),
    onSignOut: vi.fn(),
    onExport: vi.fn(),
    onErase: vi.fn(),
    onDone: vi.fn(),
    onStudyGuardReady: vi.fn(),
  };
  return { ...render(<SettingsView {...props} />), props };
}
function nav(name: string) {
  return within(screen.getByRole("navigation")).getByRole("button", { name });
}
async function finish() {
  await act(async () => {
    runs.slice().forEach((run) => run.resolve());
  });
}
it("keeps initial content still and animates admitted entries/exits with source values", () => {
  mount();
  expect(runs).toHaveLength(0);
  fireEvent.click(nav("Editor"));
  expect(
    runs.map((r) => [r.options.duration, r.options.delay, r.options.easing]),
  ).toEqual([
    [170, 0, "cubic-bezier(.4,0,.2,1)"],
    [240, 60, "cubic-bezier(.2,.8,.2,1)"],
  ]);
  expect(runs[1]!.frames).toEqual([
    { opacity: 0, transform: "translateY(6px)" },
    { opacity: 1, transform: "translateY(0px)" },
  ]);
  expect(document.querySelector('[data-phase="outgoing"]')).toHaveAttribute(
    "inert",
  );
  expect(document.querySelector('[data-phase="outgoing"]')).toHaveAttribute(
    "aria-hidden",
    "true",
  );
  expect(document.querySelector('[data-phase="incoming"]')).toHaveAttribute(
    "inert",
  );
});
it("moves pane focus to accepted navigation and blocks outgoing actions", () => {
  const { props } = mount();
  const action = screen.getByRole("button", { name: "Sign out" });
  action.focus();
  fireEvent.click(nav("Editor"));
  expect(nav("Editor")).toHaveFocus();
  fireEvent.click(action);
  expect(props.onSignOut).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Done" }));
  expect(props.onDone).toHaveBeenCalledOnce();
});
it("waits for the existing Study continuation; old lease cleanup cannot clear a new lease", async () => {
  const { props } = mount();
  fireEvent.click(nav("Study"));
  await finish();
  const old = study.registrations[0]!;
  study.admitted = false;
  fireEvent.click(nav("General"));
  expect(nav("Study")).toHaveAttribute("aria-current", "page");
  expect(document.querySelector('[data-phase="outgoing"]')).toBeNull();
  study.admitted = true;
  act(() => study.pending?.());
  // Before the 60ms entry can appear, go back. The old Study must retire first.
  fireEvent.click(nav("Study"));
  expect(
    document.querySelectorAll('form[aria-label="Synthetic Study"]'),
  ).toHaveLength(1);
  const newGuard = props.onStudyGuardReady.mock.calls.at(-1)?.[0];
  expect(newGuard).toBeTruthy();
  act(() => old(null));
  expect(props.onStudyGuardReady.mock.calls.at(-1)?.[0]).toBe(newGuard);
  study.admitted = false;
  fireEvent.click(nav("Editor"));
  expect(nav("Study")).toHaveAttribute("aria-current", "page");
});
it("never promotes a hidden delayed entry and ignores superseded completion", async () => {
  mount();
  fireEvent.click(nav("Editor"));
  const old = runs.slice();
  const entry = document.querySelector<HTMLElement>('[data-phase="incoming"]')!;
  entry.style.opacity = "0";
  fireEvent.click(nav("Journal"));
  expect(document.querySelector('[data-section="editor"]')).toBeNull();
  expect(
    document.querySelectorAll(".settings-motion-pane").length,
  ).toBeLessThanOrEqual(2);
  await act(async () => {
    old.forEach((run) => run.resolve());
  });
  expect(document.querySelector('[data-section="journal"]')).toHaveAttribute(
    "data-phase",
    "incoming",
  );
  await finish();
  expect(document.querySelectorAll(".settings-motion-pane")).toHaveLength(1);
  expect(nav("Journal")).toHaveAttribute("aria-current", "page");
});
it("ignores nested animation events and settles with a missing-completion fallback", () => {
  mount();
  fireEvent.click(nav("Editor"));
  fireEvent.animationEnd(screen.getByText("Geist"));
  expect(document.querySelector('[data-phase="incoming"]')).not.toBeNull();
  act(() => vi.advanceTimersByTime(401));
  expect(document.querySelectorAll(".settings-motion-pane")).toHaveLength(1);
  expect(document.querySelector('[data-section="editor"]')).toHaveAttribute(
    "data-phase",
    "stable",
  );
});
it("honors explicit On over OS Reduce and follows System media changes without replay", () => {
  reduced = true;
  const { props, rerender } = mount();
  fireEvent.click(nav("Editor"));
  expect(runs.at(-1)!.options.duration).toBe(240);
  rerender(<SettingsView {...props} preferences={preferences("system")} />);
  expect(document.querySelector("[data-settings-motion]")).toHaveAttribute(
    "data-settings-motion",
    "reduced",
  );
  expect(document.querySelectorAll(".settings-motion-pane")).toHaveLength(1);
  fireEvent.click(nav("Journal"));
  expect(runs.at(-1)!.options).toMatchObject({
    duration: 150,
    delay: 0,
    easing: "cubic-bezier(.4,0,.2,1)",
  });
  expect(runs.at(-1)!.frames.every((f) => f.transform === "none")).toBe(true);
  const count = runs.length;
  reduced = false;
  act(() => changes.forEach((fn) => fn()));
  expect(document.querySelector("[data-settings-motion]")).toHaveAttribute(
    "data-settings-motion",
    "full",
  );
  expect(runs).toHaveLength(count);
});
it("preserves mounted Study and its guard on policy changes", async () => {
  const { props, rerender } = mount();
  fireEvent.click(nav("Study"));
  await finish();
  const form = screen.getByRole("form");
  const guard = props.onStudyGuardReady.mock.calls.at(-1)?.[0];
  rerender(<SettingsView {...props} preferences={preferences("reduced")} />);
  expect(screen.getByRole("form")).toBe(form);
  expect(props.onStudyGuardReady.mock.calls.at(-1)?.[0]).toBe(guard);
});
it("drops exits on owner replacement, rejects old continuations and cancels on unmount", async () => {
  const { props, rerender, unmount } = mount();
  fireEvent.click(nav("Study"));
  await finish();
  study.admitted = false;
  fireEvent.click(nav("General"));
  const oldContinue = study.pending;
  rerender(<SettingsView {...props} email="replacement@example.invalid" />);
  act(() => oldContinue?.());
  expect(nav("Study")).toHaveAttribute("aria-current", "page");
  study.admitted = true;
  fireEvent.click(nav("Editor"));
  const old = runs.slice();
  unmount();
  await act(async () => old.forEach((run) => run.resolve()));
  expect(document.querySelector(".settings-layout")).toBeNull();
  expect(props.onStudyGuardReady).toHaveBeenLastCalledWith(null);
});
it("synchronously drops both-pane animation tickets on lock in the same JavaScript turn", () => {
  mount();
  fireEvent.click(nav("Editor"));
  act(() => {
    lifetime.version++;
    lifetime.locks.forEach((fn) => fn());
    expect(document.querySelectorAll(".settings-motion-pane")).toHaveLength(1);
  });
  expect(document.querySelector('[data-phase="outgoing"]')).toBeNull();
});
it("keeps the current Study lease under StrictMode effect replay", async () => {
  const props = {
    email: "strict@example.invalid",
    preferences: preferences(),
    onSignOut: vi.fn(),
    onExport: vi.fn(),
    onErase: vi.fn(),
    onDone: vi.fn(),
    onStudyGuardReady: vi.fn(),
  };
  render(
    <StrictMode>
      <SettingsView {...props} />
    </StrictMode>,
  );
  fireEvent.click(nav("Study"));
  await finish();
  study.admitted = false;
  fireEvent.click(nav("General"));
  expect(nav("Study")).toHaveAttribute("aria-current", "page");
  expect(props.onStudyGuardReady.mock.calls.at(-1)?.[0]).toBeTruthy();
});
for (const event of ["closes", "epochs"] as const) {
  it(`drops the outgoing pane and stale continuation synchronously on owner ${event}`, async () => {
    const { props, rerender } = mount();
    const owner = {
      status: "ready" as const,
      store: {} as CollectionsStore,
      identity: {
        accountId: "synthetic",
        deviceId: "device",
        email: props.email,
      },
      retry: vi.fn(),
    };
    rerender(<SettingsView {...props} studyOwner={owner} />);
    fireEvent.click(nav("Study"));
    await finish();
    study.admitted = false;
    fireEvent.click(nav("Editor"));
    const stale = study.pending;
    study.admitted = true;
    fireEvent.click(nav("General"));
    expect(document.querySelector('[data-phase="outgoing"]')).not.toBeNull();
    act(() => {
      lifetime[event].forEach((fn) => fn());
      expect(document.querySelector('[data-phase="outgoing"]')).toBeNull();
    });
    act(() => stale?.());
    expect(nav("General")).toHaveAttribute("aria-current", "page");
    expect(document.querySelector('[data-section="study"]')).toBeNull();
  });
}
it("continues an interrupted visible entry from measured opacity and translation", () => {
  mount();
  fireEvent.click(nav("Editor"));
  const entry = document.querySelector<HTMLElement>('[data-phase="incoming"]')!;
  entry.style.opacity = "0.45";
  fireEvent.click(nav("Journal"));
  expect(
    runs.filter((run) => run.element.dataset.section === "editor").at(-1)!
      .frames[0]!.opacity,
  ).toBe(0.45);
});
