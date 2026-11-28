import { AccountResponseError, type AccountServiceHandle } from "../account";
import { requireSession } from "../account/session";
import { isLocalSession } from "../data/local";
import { AccountError } from "../domain/contracts";
import type { AccountSession } from "../domain/contracts";
import type { NotesLibraryStore } from "../library/contracts";
import { readCore } from "../library/storage";
import type { DeviceList } from "../generated/contracts/DeviceList";
import type { KeyEnvelopeList } from "../generated/contracts/KeyEnvelopeList";
import type { ZoneList } from "../generated/contracts/ZoneList";
import type { ZoneChanges } from "../generated/contracts/ZoneChanges";
import type { SyncEngine } from "../data/engine";
import {
  journalChanges,
  LINKS_ZONE,
  NOTES_ZONE,
  parseEdit,
  readIndex,
  saveIndex,
  syncOwners,
  type SyncTransaction,
} from "./model";

export type PlannerTask = { id: string; zone: string; title: string };
export type TaskLink = {
  id: string;
  zone: string;
  accountId: string;
  noteId: string;
  taskId: string;
  taskZone: string;
  noteTitle: string;
  active: boolean;
};
export type EcosystemSnapshot = {
  status: string;
  error: string | null;
  tasks: PlannerTask[];
  links: TaskLink[];
  syncedAt: string | null;
};
type Applied = { changed: string[]; removed: string[]; quarantined: string[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowed = (zone: string) =>
  zone === "list:inbox" ||
  [NOTES_ZONE, LINKS_ZONE, "list:"].some(
    (prefix) => zone.startsWith(prefix) && uuid.test(zone.slice(prefix.length)),
  );
export function parseTaskLink(
  id: string,
  zone: string,
  raw: string,
  accountId: string,
): TaskLink | null {
  const record = JSON.parse(raw);
  const value = record.fields?.link?.value;
  if (
    record.record_type !== "orbyn_note_task_link_v1" ||
    !value ||
    value.accountId !== accountId ||
    !zone.startsWith(LINKS_ZONE) ||
    !uuid.test(zone.slice(LINKS_ZONE.length)) ||
    !uuid.test(id) ||
    typeof value.noteId !== "string" ||
    !value.noteId ||
    value.noteId.length > 4096 ||
    typeof value.taskId !== "string" ||
    !uuid.test(value.taskId) ||
    typeof value.taskZone !== "string" ||
    !value.taskZone.startsWith("list:") ||
    !(value.taskZone === "list:inbox" || uuid.test(value.taskZone.slice(5))) ||
    typeof value.noteTitle !== "string" ||
    value.noteTitle.length > 1000 ||
    typeof value.active !== "boolean"
  )
    return null;
  return { ...value, id, zone } as TaskLink;
}

/** One session-bound driver. All crypto mutations share the library's existing
 * IDB CAS transaction; HTTP never runs inside an IDB transaction. */
export class EcosystemSync {
  private readonly transaction: SyncTransaction;
  private closed = false;
  private started = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<void> | null = null;
  private listeners = new Set<() => void>();
  private snapshot: EcosystemSnapshot = {
    status: "Connecting",
    error: null,
    tasks: [],
    links: [],
    syncedAt: null,
  };
  constructor(
    private store: NotesLibraryStore,
    private account: Pick<AccountServiceHandle, "syncRequest">,
    private identity: AccountSession,
  ) {
    const transaction = syncOwners.get(store);
    if (
      !transaction ||
      isLocalSession(identity) ||
      identity.deviceState !== "trusted"
    )
      throw new Error("Sync requires a trusted account library.");
    this.transaction = transaction;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<EcosystemSnapshot>) {
    if (this.closed) return;
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private guard() {
    if (this.closed) throw new Error("Sync stopped.");
    requireSession(this.identity.accountId, this.identity.deviceId);
  }
  private request = async <T>(
    path: string,
    body?: unknown,
    method: "GET" | "POST" | "PUT" = "GET",
  ): Promise<T> => {
    this.guard();
    const value = await this.account.syncRequest<T>(
      this.identity,
      path,
      body,
      method,
    );
    this.guard();
    return value;
  };
  private run = <T>(
    fn: (engine: SyncEngine) => T,
    materialize = false,
    requireWritable = false,
  ) => {
    this.guard();
    return this.transaction(
      (engine) => {
        this.guard();
        return fn(engine);
      },
      materialize,
      false,
      requireWritable,
    );
  };
  private read = <T>(fn: (engine: SyncEngine) => T) => {
    this.guard();
    return this.transaction(
      (engine) => {
        this.guard();
        return fn(engine);
      },
      false,
      true,
    );
  };
  start() {
    if (this.started || this.closed) return;
    this.started = true;
    void this.syncNow();
  }
  close() {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
  }
  syncNow = (): Promise<void> => {
    if (this.running) return this.running;
    if (this.closed) return Promise.resolve();
    if (this.timer) clearTimeout(this.timer);
    this.running = (async () => {
      try {
        const hold = async () => {
          this.guard();
          await this.cycle();
        };
        if (globalThis.navigator?.locks)
          await navigator.locks.request(
            `orbyn-notes-sync:${this.identity.accountId}`,
            hold,
          );
        else await hold();
      } catch (error) {
        this.publish({
          status:
            (error instanceof AccountResponseError && error.status === 401) ||
            (error instanceof AccountError && error.code === "session_expired")
              ? "Sign in to sync"
              : "Sync paused",
          error:
            error instanceof Error
              ? error.message
              : "Couldn’t sync. Your local notes are safe.",
        });
      } finally {
        this.running = null;
        if (!this.closed)
          this.timer = setTimeout(() => {
            void this.syncNow();
          }, 3000);
      }
    })();
    return this.running;
  };
  private remember(engine: SyncEngine, zone: string, applied: Applied) {
    const index = readIndex(engine);
    const pending = new Set(index.waiting?.[zone] ?? []);
    applied.quarantined.forEach((id) => pending.add(id));
    applied.changed.forEach((id) => pending.delete(id));
    (index.waiting ??= {})[zone] = [...pending];
    if (zone.startsWith(NOTES_ZONE)) {
      for (const id of applied.changed) {
        const raw = engine.record(zone, id);
        if (raw) {
          parseEdit(id, raw);
          index.events[id] = zone;
        }
      }
      // The protocol is append-only: a server-side delete is an integrity error,
      // never permission to erase a local note or its history.
      if (applied.removed.length)
        throw new Error(
          "Synced note history was removed. Local notes were retained.",
        );
      if (Object.keys(index.events).length > 4096)
        throw new Error("The sync test edit limit was reached.");
    } else {
      const ids = new Set(index.foreign[zone] ?? []);
      applied.changed.forEach((id) => ids.add(id));
      applied.removed.forEach((id) => ids.delete(id));
      if (ids.size > 10_000)
        throw new Error("The linked-data test record limit was reached.");
      index.foreign[zone] = [...ids];
    }
    saveIndex(engine, index);
  }
  private async cycle() {
    this.publish({ status: "Syncing", error: null });
    const cached = await this.localView();
    this.publish({ tasks: cached.tasks, links: cached.links });
    const devices = await this.request<DeviceList>("/v1/devices");
    await this.run((engine) => {
      const verified = JSON.parse(
        engine.verifyDevices(JSON.stringify(devices)),
      ) as string[];
      if (!verified.includes(this.identity.deviceId))
        throw new Error("This device is no longer trusted. Sign in again.");
      const index = readIndex(engine);
      if (index.verified?.some((id) => !verified.includes(id)))
        throw new Error(
          "A device was removed. Sync is paused until key rotation is supported in this test build; local notes remain available.",
        );
      index.verified = verified;
      saveIndex(engine, index);
    });
    const envelopes = await this.request<KeyEnvelopeList>(
      "/v1/keychain/envelopes",
    );
    await this.run((engine) => {
      const accepted = JSON.parse(
        engine.acceptEnvelopes(
          JSON.stringify(envelopes),
          JSON.stringify(devices),
        ),
      ) as { zones: string[] };
      for (const zone of accepted.zones.filter(allowed))
        this.remember(
          engine,
          zone,
          JSON.parse(engine.retryQuarantined(zone, Date.now())) as Applied,
        );
    });
    const zones = new Map<string, ZoneList["zones"][number]>();
    let after: string | undefined;
    for (let page = 0; page < 100; page++) {
      const list = await this.request<ZoneList>(
        `/v1/zones${after ? `?after=${encodeURIComponent(after)}` : ""}`,
      );
      list.zones
        .filter((zone) => allowed(zone.zone))
        .forEach((zone) => zones.set(zone.zone, zone));
      after = list.next;
      if (!after) break;
      if (page === 99) throw new Error("Too many zones to sync safely.");
    }
    const own = [
      NOTES_ZONE + this.identity.deviceId,
      LINKS_ZONE + this.identity.deviceId,
    ];
    for (const zone of own) {
      if (!zones.has(zone)) {
        // Save the first key before the server zone exists. Retrying after a
        // crash keeps the same key instead of leaving an empty zone without one.
        await this.run((engine) => engine.createZoneKey(zone));
        await this.request(
          `/v1/zones/${encodeURIComponent(zone)}`,
          undefined,
          "PUT",
        );
      } else if (zones.get(zone)?.deleted)
        throw new Error(
          "This device’s sync zone was deleted. Local notes were retained.",
        );
    }
    for (const [zone, meta] of zones) {
      if (meta.deleted) {
        if (zone.startsWith(NOTES_ZONE))
          throw new Error(
            "Synced note history was removed. Local notes were retained.",
          );
        await this.run((engine) => {
          const index = readIndex(engine);
          index.foreign[zone] = [];
          if (index.waiting) delete index.waiting[zone];
          saveIndex(engine, index);
        });
        continue;
      }
      for (let page = 0; page < 100; page++) {
        const since = await this.read((engine) => engine.token(zone));
        if (since === meta.token) break;
        let body: ZoneChanges;
        try {
          body = await this.request<ZoneChanges>(
            `/v1/zones/${encodeURIComponent(zone)}/changes?limit=200${since ? `&since=${encodeURIComponent(since)}` : ""}`,
          );
        } catch (error) {
          if (error instanceof AccountResponseError && error.status === 410) {
            await this.run((engine) => engine.tokenExpired(zone));
            continue;
          }
          throw error;
        }
        await this.run((engine) => {
          const applied = JSON.parse(
            engine.applyChangesFrom(
              zone,
              since,
              JSON.stringify(body),
              Date.now(),
            ),
          ) as Applied;
          this.remember(engine, zone, applied);
        });
        if (!body.more) break;
        if (page === 99) throw new Error("Too many changes to sync safely.");
      }
    }
    // Only this device owns these new zones: no first-key race between devices.
    // Keys are acknowledged before records leave this device.
    for (const zone of own) {
      const marker = JSON.stringify(
        devices.devices
          .filter((device) => device.state === "trusted")
          .map((device) => [
            device.id,
            device.approval_id,
            device.approval_signature,
          ])
          .sort(),
      );
      if (
        await this.read(
          (engine) => readIndex(engine).keysSent?.[zone] === marker,
        )
      )
        continue;
      const put = await this.run(
        (engine) =>
          JSON.parse(engine.envelopesFor(zone, JSON.stringify(devices))) as {
            envelopes: unknown[];
          },
      );
      if (put.envelopes.length)
        await this.request("/v1/keychain/envelopes", put, "POST");
      await this.run((engine) => {
        const index = readIndex(engine);
        (index.keysSent ??= {})[zone] = marker;
        saveIndex(engine, index);
      });
    }
    await this.run((engine) => {
      const index = readIndex(engine);
      if (!index.enabled) {
        index.enabled = true;
        index.zone = own[0]!;
        saveIndex(engine, index);
        journalChanges(engine, [], readCore(engine, "notes").notes);
      }
    }, true);
    for (const zone of own) {
      for (let batch = 0; batch < 50; batch++) {
        const upload = await this.run((engine) => engine.buildUpload(zone));
        if (!upload) break;
        try {
          const result = await this.request(
            `/v1/zones/${encodeURIComponent(zone)}/changes`,
            JSON.parse(upload),
            "POST",
          );
          await this.run((engine) =>
            engine.uploadSucceeded(zone, JSON.stringify(result)),
          );
        } catch (error) {
          if (
            error instanceof AccountResponseError &&
            error.code === "record_changed"
          ) {
            await this.run((engine) =>
              this.remember(
                engine,
                zone,
                JSON.parse(
                  engine.uploadConflicted(
                    zone,
                    JSON.stringify(error.body),
                    Date.now(),
                  ),
                ) as Applied,
              ),
            );
            continue;
          }
          throw error;
        }
        if (batch === 49)
          throw new Error("More local changes are waiting to sync.");
      }
    }
    const data = await this.localView(true);
    this.publish({
      tasks: data.tasks,
      links: data.links,
      status: data.waiting ? "Waiting for device keys" : "Synced",
      error: null,
      syncedAt: new Date().toISOString(),
    });
  }
  private async localView(materialize = false) {
    const project = (engine: SyncEngine) => {
      const index = readIndex(engine);
      const tasks: PlannerTask[] = [],
        links: TaskLink[] = [];
      for (const [zone, ids] of Object.entries(index.foreign))
        for (const id of ids) {
          const raw = engine.record(zone, id);
          if (!raw) continue;
          if (zone.startsWith(LINKS_ZONE)) {
            const link = parseTaskLink(id, zone, raw, this.identity.accountId);
            if (link) links.push(link);
          } else if (zone.startsWith("list:")) {
            const record = JSON.parse(raw),
              fields = record.fields;
            if (
              record.record_type === "task" &&
              uuid.test(id) &&
              typeof fields?.title?.value === "string" &&
              fields.title.value.length <= 1000 &&
              fields?.listId?.value === zone.slice(5) &&
              !fields?._deleted?.value &&
              !fields?.deletedAt?.value
            )
              tasks.push({ id, zone, title: fields.title.value });
          }
        }
      return {
        tasks,
        links,
        waiting: Object.values(index.waiting ?? {}).some(
          (ids) => ids.length > 0,
        ),
      };
    };
    return materialize ? this.run(project, true) : this.read(project);
  }
  async link(noteId: string, task: PlannerTask): Promise<void> {
    const current = await this.store.get(noteId);
    if (!current || current.trashedAt)
      throw new Error("Open a saved note before linking a task.");
    if (
      !this.snapshot.tasks.some(
        (value) => value.id === task.id && value.zone === task.zone,
      )
    )
      throw new Error("This task is no longer available.");
    const zone = LINKS_ZONE + this.identity.deviceId;
    const saved = await this.run(
      (engine) => {
        const index = readIndex(engine);
        const existing = (index.foreign[zone] ?? [])
          .flatMap((id) => {
            const raw = engine.record(zone, id);
            const link = raw
              ? parseTaskLink(id, zone, raw, this.identity.accountId)
              : null;
            return link ? [link] : [];
          })
          .find(
            (link) =>
              link.noteId === noteId &&
              link.taskId === task.id &&
              link.taskZone === task.zone,
          );
        const id = existing?.id ?? crypto.randomUUID();
        const link = {
          accountId: this.identity.accountId,
          noteId,
          taskId: task.id,
          taskZone: task.zone,
          noteTitle: current.title || "Untitled note",
          active: true,
        };
        engine.stage(
          zone,
          "orbyn_note_task_link_v1",
          id,
          JSON.stringify({
            link: { value: link, stamp: JSON.parse(engine.tick(Date.now())) },
          }),
        );
        index.foreign[zone] = [
          ...new Set([...(index.foreign[zone] ?? []), id]),
        ];
        saveIndex(engine, index);
        return { ...link, id, zone };
      },
      false,
      true,
    );
    this.publish({
      links: [
        ...this.snapshot.links.filter(
          (link) => link.id !== saved.id || link.zone !== saved.zone,
        ),
        saved,
      ],
    });
    await this.syncNow();
  }
}
