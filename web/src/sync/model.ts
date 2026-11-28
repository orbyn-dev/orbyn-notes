import type { Note } from "../domain/contracts";
import { validateNotes } from "../domain/validation";
import type { SyncEngine } from "../data/engine";

// Only these two zones may be uploaded by Notes. Local library, history,
// collections and approval records must never be enumerated for upload.
export const NOTES_ZONE = "notes-sync:";
export const LINKS_ZONE = "notes-links:";
const LOCAL_ZONE = "notes-local-sync-v1";
const EVENT_TYPE = "orbyn_note_edit_v1";
const LIMIT = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type Edit = {
  id: string;
  root: string;
  parent: string | null;
  note: Note;
};
export type SyncIndex = {
  enabled: boolean;
  zone: string;
  events: Record<string, string>;
  foreign: Record<string, string[]>;
  aliases: Record<string, { root: string; head: string }>;
  verified?: string[];
  keysSent?: Record<string, string>;
  waiting?: Record<string, string[]>;
};
export function readIndex(engine: SyncEngine): SyncIndex {
  const raw = engine.record(LOCAL_ZONE, "index");
  const index = raw
    ? (JSON.parse(raw).fields.index.value as SyncIndex)
    : { enabled: false, zone: "", events: {}, foreign: {}, aliases: {} };
  // Note IDs are opaque storage data, including names from Object.prototype.
  index.aliases = Object.assign(Object.create(null), index.aliases);
  return index;
}
export function saveIndex(engine: SyncEngine, index: SyncIndex): void {
  engine.stage(
    LOCAL_ZONE,
    "notes_sync_index",
    "index",
    JSON.stringify({
      index: { value: index, stamp: JSON.parse(engine.tick(Date.now())) },
    }),
  );
}
export function sameContent(a: Note, b: Note): boolean {
  return (
    JSON.stringify({ ...a, revision: 0, id: "" }) ===
    JSON.stringify({ ...b, revision: 0, id: "" })
  );
}
export function parseEdit(id: string, raw: string): Edit {
  const record = JSON.parse(raw);
  if (record.record_type !== EVENT_TYPE)
    throw new Error("Unsupported note sync record.");
  const edit = record.fields?.edit?.value as Edit;
  if (
    !edit ||
    !UUID.test(id) ||
    edit.id !== id ||
    typeof edit.root !== "string" ||
    !edit.root ||
    edit.root.length > 4096 ||
    !(
      edit.parent === null ||
      (typeof edit.parent === "string" && UUID.test(edit.parent))
    ) ||
    edit.parent === id
  )
    throw new Error("Invalid note sync record.");
  const [note] = validateNotes([edit.note], "notes");
  if (!note) throw new Error("Invalid synced note.");
  return { id, root: edit.root, parent: edit.parent, note };
}

/** Immutable edits form causal branches. Concurrent heads become separate notes;
 * they are never resolved by device clocks or whole-library last-writer-wins. */
export function projectEdits(edits: readonly Edit[]): {
  notes: Note[];
  aliases: SyncIndex["aliases"];
} {
  if (edits.length > LIMIT)
    throw new Error("The sync test library has reached its edit limit.");
  const byId = new Map(edits.map((e) => [e.id, e]));
  if (byId.size !== edits.length) throw new Error("Duplicate synced edit.");
  const children = new Map<string, Edit[]>(),
    roots = new Map<string, Edit[]>();
  for (const edit of edits) {
    if (edit.parent === null) {
      roots.set(edit.root, [...(roots.get(edit.root) ?? []), edit]);
    } else {
      const parent = byId.get(edit.parent);
      // A partial page must not replace a valid local note with an orphan.
      if (!parent || parent.root !== edit.root) continue;
      children.set(parent.id, [...(children.get(parent.id) ?? []), edit]);
    }
  }
  const notes: Note[] = [],
    aliases: SyncIndex["aliases"] = Object.create(null);
  for (const [root, list] of [...roots].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const stack = list
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((edit, i) => ({ edit, visibleId: i === 0 ? root : edit.id }))
      .reverse();
    while (stack.length) {
      const { edit, visibleId } = stack.pop()!;
      const next = (children.get(edit.id) ?? []).sort((a, b) =>
        a.id.localeCompare(b.id),
      );
      if (!next.length) {
        notes.push({ ...edit.note, id: visibleId });
        aliases[visibleId] = { root: edit.root, head: edit.id };
      } else
        for (let i = next.length - 1; i >= 0; i--) {
          const child = next[i]!;
          stack.push({
            edit: child,
            visibleId: i === 0 ? visibleId : child.id,
          });
        }
    }
  }
  return { notes, aliases };
}
export function journalChanges(
  engine: SyncEngine,
  before: readonly Note[],
  after: readonly Note[],
): void {
  const index = readIndex(engine);
  if (!index.enabled) return;
  if (before.some((note) => !after.some((next) => next.id === note.id)))
    throw new Error(
      "Permanent deletion is unavailable in the sync test. Move notes to Trash instead.",
    );
  for (const note of after) {
    const old = before.find((n) => n.id === note.id);
    if (old && sameContent(old, note)) continue;
    if (Object.keys(index.events).length >= LIMIT)
      throw new Error(
        "The sync test library has reached its edit limit. Your draft was not saved.",
      );
    const alias = index.aliases[note.id];
    const edit: Edit = {
      id: crypto.randomUUID(),
      root: alias?.root ?? note.id,
      parent: alias?.head ?? null,
      note,
    };
    const fields = JSON.stringify({
      edit: { value: edit, stamp: JSON.parse(engine.tick(Date.now())) },
    });
    if (new TextEncoder().encode(fields).length > 190_000)
      throw new Error(
        "This note is too large for the sync test. Keep a local copy before shortening it.",
      );
    engine.stage(index.zone, EVENT_TYPE, edit.id, fields);
    index.events[edit.id] = index.zone;
    index.aliases[note.id] = { root: edit.root, head: edit.id };
  }
  saveIndex(engine, index);
}
export function projected(engine: SyncEngine) {
  const index = readIndex(engine);
  const edits = Object.entries(index.events).flatMap(([id, zone]) => {
    const raw = engine.record(zone, id);
    return raw ? [parseEdit(id, raw)] : [];
  });
  const result = projectEdits(edits);
  index.aliases = result.aliases;
  saveIndex(engine, index);
  return result.notes;
}
export type SyncTransaction = <T>(
  run: (engine: SyncEngine) => T,
  materialize?: boolean,
  readOnly?: boolean,
  requireWritable?: boolean,
) => Promise<T>;
export const syncOwners = new WeakMap<object, SyncTransaction>();
