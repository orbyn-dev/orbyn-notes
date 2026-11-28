import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import type { AccountServiceHandle } from "../account";
import type { AccountSession } from "../domain/contracts";
import type { NotesLibraryStore } from "../library/contracts";
import { EcosystemSync } from "./cycle";
import { Dialog } from "../ui/primitives";
import { formatWebNoteLink } from "../links/entry";
import "./sync.css";

const Context = createContext<EcosystemSync | null>(null);
const noSubscribe = () => () => {};
const noSnapshot = () => null;
export function configuredAppUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      !(
        url.protocol === "https:" ||
        (url.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
      )
    )
      return null;
    return url;
  } catch {
    return null;
  }
}
export function EcosystemProvider({
  children,
  store,
  service,
  identity,
}: {
  children: ReactNode;
  store: NotesLibraryStore;
  service: AccountServiceHandle;
  identity: AccountSession;
}) {
  const [controller, setController] = useState<EcosystemSync | null>(null);
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    if (query.get("connect") === "1") {
      query.delete("connect");
      history.replaceState(
        null,
        "",
        location.pathname + (query.size ? `?${query}` : "") + location.hash,
      );
    }
    const next = new EcosystemSync(store, service, identity);
    setController(next);
    next.start();
    return () => next.close();
  }, [store, service, identity]);
  return (
    <Context.Provider value={controller}>
      <SyncNotice store={store} identity={identity} />
      {children}
    </Context.Provider>
  );
}
function useEcosystem() {
  const controller = useContext(Context);
  const state = useSyncExternalStore(
    controller?.subscribe ?? noSubscribe,
    controller?.getSnapshot ?? noSnapshot,
  );
  return { controller, state };
}
export function useEcosystemEnabled() {
  return useContext(Context) !== null;
}
function SyncNotice({
  store,
  identity,
}: {
  store: NotesLibraryStore;
  identity: AccountSession;
}) {
  const { controller, state } = useEcosystem();
  const [linkError, setLinkError] = useState("");
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const noteId = query.get("orbynNote"),
      accountId = query.get("orbynAccount");
    if (!noteId || !accountId) return;
    if (accountId !== identity.accountId) {
      setLinkError(
        "This note belongs to a different account. Sign in to that account to open it.",
      );
      return;
    }
    let active = true;
    void store.library
      .read()
      .then((value) => {
        if (
          !active ||
          value.mode !== "ready" ||
          !value.snapshot.notes.some((note) => note.id === noteId)
        )
          return;
        const link = formatWebNoteLink(
          {
            kind: "note",
            accountId,
            libraryEpoch: value.snapshot.token.epoch,
            noteId,
          },
          location.href,
        );
        history.replaceState(null, "", location.pathname);
        location.hash = new URL(link.text).hash;
      })
      .catch(() => {
        if (active)
          setLinkError(
            "Couldn’t open the linked note. Your workspace was not changed.",
          );
      });
    return () => {
      active = false;
    };
  }, [state?.syncedAt, identity.accountId, store]);
  return (
    <div className="ecosystem-status" aria-live="polite">
      <span>Account sync test · {state?.status ?? "Connecting"}</span>
      <button onClick={() => void controller?.syncNow()}>Sync now</button>
      {state?.error && (
        <>
          <span role="alert">{state.error}</span>
          <a href="?connect=1">Sign in to sync</a>
        </>
      )}
      {linkError && <span role="alert">{linkError}</span>}
    </div>
  );
}
/** Notes Designs 2be4f2d: link-picker / planner-note, task-only test slice. */
export function PlannerLinks({ noteId }: { noteId: string }) {
  const { controller, state } = useEcosystem();
  const [open, setOpen] = useState(false),
    [query, setQuery] = useState("");
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (!controller || !state) return null;
  const app = configuredAppUrl(import.meta.env.VITE_PLANNER_URL);
  const links = state.links.filter(
    (link) => link.noteId === noteId && link.active,
  );
  return (
    <div className="ecosystem-links">
      {links.map((link) => {
        const task = state.tasks.find(
          (task) => task.id === link.taskId && task.zone === link.taskZone,
        );
        const href = app && new URL("/tasks", app);
        if (href) {
          href.searchParams.set("orbynTask", link.taskId);
          href.searchParams.set("orbynAccount", link.accountId);
        }
        return (
          <span className="ecosystem-task-chip" key={link.id}>
            {task && href ? (
              <a
                href={href.href}
                target="_blank"
                rel="noopener noreferrer"
                title="Open in Planner"
              >
                {task.title}
              </a>
            ) : (
              "Task unavailable"
            )}
          </span>
        );
      })}
      <button
        onClick={() => {
          setOpen(true);
          setError("");
        }}
      >
        Link a task
      </button>
      {open && (
        <Dialog
          title="Link a task"
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <label>
            Search tasks
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <p className="t3">Tasks · Planner</p>
          <div className="ecosystem-picker">
            {state.tasks
              .filter((task) =>
                task.title
                  .toLocaleLowerCase()
                  .includes(query.toLocaleLowerCase()),
              )
              .map((task) => (
                <button
                  disabled={busy}
                  key={`${task.zone}:${task.id}`}
                  onClick={() => {
                    setBusy(true);
                    setError("");
                    void controller
                      .link(noteId, task)
                      .then(() => setOpen(false))
                      .catch((error) =>
                        setError(
                          error instanceof Error
                            ? error.message
                            : "Couldn’t link this task.",
                        ),
                      )
                      .finally(() => setBusy(false));
                  }}
                >
                  {task.title}
                </button>
              ))}
            {!state.tasks.length && (
              <p>
                Planner tasks will appear after both trusted apps sync with this
                account.
              </p>
            )}
          </div>
          {error && <p role="alert">{error}</p>}
          <button disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </button>
        </Dialog>
      )}
    </div>
  );
}
