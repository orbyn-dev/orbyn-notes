import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { lockVersion, onLock } from "../account/session";
import {
  onCollectionsClose,
  onCollectionsEpochChange,
} from "../collections/store";
import type { StudySettingsOwner } from "./studySettingsTypes";

export type SettingsSection =
  "general" | "editor" | "sync" | "study" | "journal" | "apps" | "data";
export type MotionPolicy = "full" | "reduced";
export const enterEase = "cubic-bezier(.2,.8,.2,1)";
export const exitEase = "cubic-bezier(.4,0,.2,1)";
const stores = new WeakMap<object, number>();
let storeId = 0;
export function useSettingsGeneration(
  owner: StudySettingsOwner,
  email: string,
) {
  const [revision, setRevision] = useState(0);
  const store = owner.status === "ready" ? owner.store : null;
  useLayoutEffect(() => {
    const invalidate = () => flushSync(() => setRevision((value) => value + 1));
    const stopLock = onLock(invalidate);
    let stopClose: (() => void) | undefined,
      stopEpoch: (() => void) | undefined;
    try {
      if (store) {
        stopClose = onCollectionsClose(store, invalidate);
        stopEpoch = onCollectionsEpochChange(store, invalidate);
      }
    } catch {
      // The current Study owner performs its own synchronous revocation. Do not retain an exit.
      setRevision((value) => value + 1);
    }
    return () => {
      stopLock();
      stopClose?.();
      stopEpoch?.();
    };
  }, [store]);
  if (store && !stores.has(store)) stores.set(store, ++storeId);
  const signature = JSON.stringify([
    email,
    owner.status,
    store && stores.get(store),
    owner.status === "ready" && [
      owner.identity.accountId,
      owner.identity.deviceId,
      owner.identity.email,
    ],
    lockVersion(),
    revision,
  ]);
  const generation = useRef({ signature, value: 0 });
  if (generation.current.signature !== signature)
    generation.current = { signature, value: generation.current.value + 1 };
  return generation.current.value;
}
export function useSettingsMotion(preference: string): MotionPolicy {
  const [system, setSystem] = useState(
    () =>
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useLayoutEffect(() => {
    const media = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!media) return;
    const update = () => setSystem(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return preference === "on"
    ? "full"
    : preference === "reduced" || system
      ? "reduced"
      : "full";
}
export type Pane = {
  section: SettingsSection;
  instanceId: number;
  ownerGeneration: number;
  phase: "stable" | "incoming" | "outgoing";
  opacity?: number;
  y?: number;
};
type Presence = {
  generation: number;
  policy: MotionPolicy;
  current: Pane;
  outgoing: Pane | null;
};
export function useSettingsPresence(generation: number, policy: MotionPolicy) {
  const serial = useRef(0),
    elements = useRef(new Map<number, HTMLDivElement>());
  const [state, setState] = useState<Presence>(() => ({
    generation,
    policy,
    current: {
      section: "general",
      instanceId: ++serial.current,
      ownerGeneration: generation,
      phase: "stable",
    },
    outgoing: null,
  }));
  if (state.generation !== generation || state.policy !== policy) {
    setState({
      generation,
      policy,
      current: {
        ...state.current,
        instanceId:
          state.generation === generation
            ? state.current.instanceId
            : ++serial.current,
        ownerGeneration: generation,
        phase: "stable",
      },
      outgoing: null,
    });
  }
  const latest = useRef({ generation, alive: true });
  latest.current.generation = generation;
  useLayoutEffect(() => {
    latest.current.alive = true;
    return () => {
      latest.current.alive = false;
    };
  }, []);
  function navigate(section: SettingsSection) {
    if (!latest.current.alive || latest.current.generation !== generation)
      return;
    setState((previous) => {
      if (previous.current.section === section) return previous;
      const element = elements.current.get(previous.current.instanceId);
      const style = element && getComputedStyle(element);
      const opacity =
        previous.current.phase === "stable" ? 1 : Number(style?.opacity ?? 0);
      const transform = style?.transform;
      const y =
        transform &&
        transform !== "none" &&
        typeof DOMMatrixReadOnly !== "undefined"
          ? new DOMMatrixReadOnly(transform).m42
          : 0;
      // An unseen delayed entry must never flash as an exit. Keep the visible exit instead.
      let outgoing =
        opacity > 0
          ? { ...previous.current, phase: "outgoing" as const, opacity, y }
          : previous.outgoing;
      if (outgoing?.section === "study" && section === "study") outgoing = null;
      return {
        ...previous,
        current: {
          section,
          instanceId: ++serial.current,
          ownerGeneration: generation,
          phase: "incoming",
        },
        outgoing,
      };
    });
  }
  function complete(pane: Pane) {
    if (
      !latest.current.alive ||
      latest.current.generation !== pane.ownerGeneration
    )
      return;
    setState((previous) => ({
      ...previous,
      current:
        previous.current.instanceId === pane.instanceId &&
        pane.phase === "incoming"
          ? { ...previous.current, phase: "stable" }
          : previous.current,
      outgoing:
        previous.outgoing?.instanceId === pane.instanceId &&
        pane.phase === "outgoing"
          ? null
          : previous.outgoing,
    }));
  }
  return {
    ...state,
    elements,
    navigate,
    complete,
  };
}

export function SettingsMotionPane({
  pane,
  policy,
  elements,
  complete,
  children,
}: {
  pane: Pane;
  policy: MotionPolicy;
  elements: React.RefObject<Map<number, HTMLDivElement>>;
  complete: (pane: Pane) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null),
    done = useRef(complete);
  done.current = complete;
  useLayoutEffect(() => {
    const element = ref.current!;
    elements.current.set(pane.instanceId, element);
    return () => {
      elements.current.delete(pane.instanceId);
    };
  }, [elements, pane.instanceId]);
  useLayoutEffect(() => {
    const element = ref.current!;
    if (pane.phase === "stable") return;
    const incoming = pane.phase === "incoming",
      reduced = policy === "reduced";
    const duration = reduced ? 150 : incoming ? 240 : 170,
      delay = !reduced && incoming ? 60 : 0;
    let cancelled = false;
    const finish = () => {
      if (!cancelled && ref.current === element) done.current(pane);
    };
    if (!element.animate) {
      finish();
      return;
    }
    const animation = element.animate(
      [
        {
          opacity: incoming ? 0 : (pane.opacity ?? 1),
          transform: reduced
            ? "none"
            : `translateY(${incoming ? 6 : (pane.y ?? 0)}px)`,
        },
        {
          opacity: incoming ? 1 : 0,
          transform: reduced ? "none" : `translateY(${incoming ? 0 : 6}px)`,
        },
      ],
      {
        duration,
        delay,
        easing: incoming && !reduced ? enterEase : exitEase,
        fill: "both",
      },
    );
    animation.finished.then(finish, () => {});
    const fallback = window.setTimeout(finish, duration + delay + 100);
    return () => {
      cancelled = true;
      clearTimeout(fallback);
      animation.cancel();
    };
  }, [pane.instanceId, pane.phase, pane.opacity, pane.y, policy]);
  const inactive = pane.phase !== "stable";
  return (
    <div
      ref={ref}
      className={`settings-motion-pane${pane.section === "study" ? " settings-study-pane" : ""}`}
      data-section={pane.section}
      data-phase={pane.phase}
      inert={inactive}
      aria-hidden={pane.phase === "outgoing" || undefined}
      onClickCapture={(event) => {
        if (inactive) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      {children}
    </div>
  );
}

// Numeric geometry only; labels and control values remain in their original owners.
export function SettingsIndicator({
  children,
  className,
  selector,
  policy,
  label,
}: {
  children: ReactNode;
  className: string;
  selector: string;
  policy: MotionPolicy;
  label?: string;
}) {
  const root = useRef<HTMLDivElement>(null),
    thumb = useRef<HTMLSpanElement>(null),
    initialized = useRef(false);
  useLayoutEffect(() => {
    const element = root.current!,
      indicator = thumb.current!;
    const update = () => {
      const selected = element.querySelector<HTMLElement>(selector);
      if (!selected) return;
      const parent = element.getBoundingClientRect(),
        target = selected.getBoundingClientRect();
      indicator.style.transitionDuration =
        initialized.current && policy === "full" ? "200ms" : "0ms";
      indicator.style.width = `${target.width}px`;
      indicator.style.height = `${target.height}px`;
      indicator.style.transform = `translate(${target.left - parent.left - element.clientLeft + element.scrollLeft}px, ${target.top - parent.top - element.clientTop + element.scrollTop}px)`;
      initialized.current = true;
    };
    update();
    const resize =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    resize?.observe(element);
    return () => resize?.disconnect();
  }, [children, selector, policy]);
  return (
    <div
      ref={root}
      className={className}
      role={label ? "group" : undefined}
      aria-label={label}
    >
      <span ref={thumb} className="settings-indicator" aria-hidden="true" />
      {children}
    </div>
  );
}
