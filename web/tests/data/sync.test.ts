// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { IDBFactory, IDBObjectStore } from "fake-indexeddb";
import { initSync, DeviceKeys } from "../../src/generated/wasm/orbyn_wasm.js";
import { openNotesStore } from "../../src/data";
import {
  newWrappingKey,
  wrappingSecret,
  mutateRecord,
  readRecord,
  type DeviceRecord,
} from "../../src/data/database";
import { establish, lock } from "../../src/account/session";
import { RevisionConflictError } from "../../src/domain/contracts";
import type { Device } from "../../src/generated/contracts/Device";
import type { AccountSession } from "../../src/domain/contracts";
import { EcosystemSync } from "../../src/sync/cycle";
import {
  NOTES_ZONE,
  LINKS_ZONE,
  readIndex,
  saveIndex,
  syncOwners,
  type Edit,
} from "../../src/sync/model";
const identity = {
  accountId: "11111111-1111-4111-8111-111111111111",
  deviceId: "22222222-2222-4222-8222-222222222222",
  email: "sync@example.test",
  deviceState: "trusted" as const,
};
let publicDevice: Device;
const input = {
  title: "Encrypted sync title",
  document: {
    type: "doc" as const,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: "Encrypted sync body" }],
      },
    ],
  },
  tags: ["test"],
};
beforeAll(async () =>
  initSync({
    module: await readFile(
      new URL("../../src/generated/wasm/orbyn_wasm_bg.wasm", import.meta.url),
    ),
  }),
);
beforeEach(async () => {
  lock();
  vi.stubGlobal("indexedDB", new IDBFactory());
  const wrapKey = await newWrappingKey(),
    secret = await wrappingSecret(wrapKey),
    keys = DeviceKeys.create();
  publicDevice = {
    id: identity.deviceId,
    name: "Synthetic device",
    platform: "web",
    state: "trusted",
    signing_key: keys.signingKey(),
    agreement_key: keys.agreementKey(),
    created_at: new Date().toISOString(),
    approved_by: null,
    approval_signature: null,
    current: true,
  };
  try {
    await mutateRecord<DeviceRecord>("devices", identity.email, () => ({
      ...identity,
      wrapKey,
      sealedKeys: keys.export(secret),
      generation: 0,
    }));
  } finally {
    keys.free();
    secret.fill(0);
  }
  establish(identity);
});
async function enrolled() {
  const store = await openNotesStore(identity),
    transaction = syncOwners.get(store)!;
  await transaction((engine) => {
    const index = readIndex(engine);
    index.enabled = true;
    index.zone = NOTES_ZONE + identity.deviceId;
    engine.createZoneKey(index.zone);
    saveIndex(engine, index);
  });
  return { store, transaction };
}
async function cachedTask() {
  const { store, transaction } = await enrolled();
  const note = await store.create(input),
    task = {
      id: crypto.randomUUID(),
      zone: "list:inbox",
      title: "Saved Planner task",
    };
  await transaction((engine) => {
    engine.createZoneKey(task.zone);
    engine.createZoneKey(LINKS_ZONE + identity.deviceId);
    const stamp = JSON.parse(engine.tick(Date.now()));
    engine.stage(
      task.zone,
      "task",
      task.id,
      JSON.stringify({
        title: { value: task.title, stamp },
        listId: { value: "inbox", stamp },
      }),
    );
    const index = readIndex(engine);
    index.foreign[task.zone] = [task.id];
    saveIndex(engine, index);
  });
  const controller = new EcosystemSync(
    store,
    {
      syncRequest: async () => {
        throw new Error("Engine offline");
      },
    },
    identity,
  );
  await controller.syncNow();
  return { store, transaction, note, task, controller };
}
describe("real engine sync persistence", () => {
  it("rejects a relationship write from an old library epoch", async () => {
    const { store, transaction, note, task, controller } = await cachedTask();
    try {
      await transaction((engine) => {
        const raw = JSON.parse(engine.record("notes-library-v1", "workspace")!);
        engine.stage(
          "notes-library-v1",
          "notes_library_metadata",
          "workspace",
          JSON.stringify({
            library: {
              value: {
                ...raw.fields.library.value,
                epoch: crypto.randomUUID(),
              },
              stamp: JSON.parse(engine.tick(Date.now())),
            },
          }),
        );
      });
      await expect(controller.link(note.id, task)).rejects.toMatchObject({
        code: "library_epoch_changed",
      });
    } finally {
      controller.close();
      store.close();
    }
  });
  it("shows locally committed relationships offline and deduplicates racing retries from stored records", async () => {
    const { store, transaction, note, task, controller } = await cachedTask();
    try {
      expect(controller.getSnapshot().tasks).toContainEqual(task);
      await Promise.all([
        controller.link(note.id, task),
        controller.link(note.id, task),
      ]);
      expect(controller.getSnapshot().links).toHaveLength(1);
      expect(controller.getSnapshot().links[0]).toMatchObject({
        noteId: note.id,
        taskId: task.id,
      });
      expect(controller.getSnapshot().status).toBe("Sync paused");
      expect(controller.getSnapshot().error).toContain("Engine offline");
      expect(
        (await transaction(readIndex, false, true)).foreign[
          LINKS_ZONE + identity.deviceId
        ],
      ).toHaveLength(1);
    } finally {
      controller.close();
      store.close();
    }
  });
  it("rejects relationship writes during persistent link-index recovery", async () => {
    const { store, transaction, note, task, controller } = await cachedTask();
    try {
      await transaction((engine) => {
        const raw = JSON.parse(engine.record("notes-library-v1", "workspace")!);
        const library = {
          ...raw.fields.library.value,
          version: 3,
          noteLinks: "invalid index",
        };
        engine.stage(
          "notes-library-v1",
          "notes_library_metadata",
          "workspace",
          JSON.stringify({
            library: {
              value: library,
              stamp: JSON.parse(engine.tick(Date.now())),
            },
          }),
        );
      });
      await expect(controller.link(note.id, task)).rejects.toMatchObject({
        code: "note_link_index_invalid",
      });
    } finally {
      controller.close();
      store.close();
    }
  });
  it("clears pending device-key status when a Planner zone has been deleted", async () => {
    const { store, transaction } = await enrolled();
    await transaction((engine) => {
      engine.createZoneKey(LINKS_ZONE + identity.deviceId);
      const index = readIndex(engine);
      index.foreign["list:inbox"] = [crypto.randomUUID()];
      index.waiting = { "list:inbox": ["old-record"] };
      saveIndex(engine, index);
    });
    const controller = new EcosystemSync(
      store,
      {
        syncRequest: async <T>(
          _identity: AccountSession,
          path: string,
        ): Promise<T> => {
          if (path === "/v1/devices")
            return { devices: [publicDevice], removals: [] } as T;
          if (path === "/v1/keychain/envelopes") return { envelopes: [] } as T;
          if (path === "/v1/zones")
            return {
              zones: [
                NOTES_ZONE + identity.deviceId,
                LINKS_ZONE + identity.deviceId,
                "list:inbox",
              ].map((zone) => ({
                zone,
                token: "token-0",
                deleted: zone === "list:inbox",
                created_at: new Date().toISOString(),
              })),
            } as T;
          if (path.includes("/changes?"))
            return {
              records: [],
              token: "token-0",
              more: false,
              zone_deleted: false,
            } as T;
          throw new Error("Unexpected request: " + path);
        },
      },
      identity,
    );
    try {
      await controller.syncNow();
      expect(controller.getSnapshot().status).toBe("Synced");
      const index = await transaction(readIndex, false, true);
      expect(index.foreign["list:inbox"]).toEqual([]);
      expect(index.waiting?.["list:inbox"]).toBeUndefined();
    } finally {
      controller.close();
      store.close();
    }
  });
  it("materializes a remote note reference into a valid v2 library with a maintained v3 index", async () => {
    const { store, transaction } = await enrolled();
    const note = await store.create(input);
    const view = await store.library.read();
    if (view.mode !== "ready") throw new Error("Expected a ready library");
    const document = {
      type: "doc" as const,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "noteLink",
              attrs: {
                version: 1,
                target: {
                  kind: "note",
                  accountId: identity.accountId,
                  libraryEpoch: view.snapshot.token.epoch,
                  noteId: note.id,
                },
              },
            },
          ],
        },
      ],
    };
    await transaction((engine) => {
      const index = readIndex(engine),
        id = crypto.randomUUID();
      const edit: Edit = {
        id,
        root: note.id,
        parent: index.aliases[note.id]!.head,
        note: { ...note, document },
      };
      engine.stage(
        index.zone,
        "orbyn_note_edit_v1",
        id,
        JSON.stringify({
          edit: { value: edit, stamp: JSON.parse(engine.tick(Date.now())) },
        }),
      );
      index.events[id] = index.zone;
      saveIndex(engine, index);
    }, true);
    expect((await store.get(note.id))?.document).toEqual(document);
    expect(
      await transaction(
        (engine) =>
          JSON.parse(engine.record("notes-library-v1", "workspace")!).fields
            .library.value.version,
        false,
        true,
      ),
    ).toBe(3);
    store.close();
  });
  it("commits a note and immutable outbox edit together, sealed on disk", async () => {
    const { store, transaction } = await enrolled();
    const note = await store.create(input);
    const index = await transaction(readIndex);
    expect(Object.keys(index.events)).toHaveLength(1);
    expect(index.aliases[note.id]?.root).toBe(note.id);
    const record = await readRecord<DeviceRecord>("devices", identity.email);
    expect(new TextDecoder().decode(record!.snapshot)).not.toContain(
      input.title,
    );
    store.close();
    const reopened = await openNotesStore(identity);
    expect(await reopened.get(note.id)).toEqual(note);
    expect(
      Object.keys(
        await syncOwners.get(reopened)!((engine) => readIndex(engine).events),
      ),
    ).toHaveLength(1);
    reopened.close();
  });
  it("rolls both note and pending edit back on a failed IDB commit", async () => {
    const { store, transaction } = await enrolled();
    const note = await store.create(input),
      before = await transaction(readIndex);
    const put = vi
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementationOnce(() => {
        throw new DOMException("Synthetic quota", "QuotaExceededError");
      });
    await expect(
      store.update(
        note.id,
        { title: "Must stay in the visible draft" },
        note.revision,
      ),
    ).rejects.toThrow("Synthetic quota");
    put.mockRestore();
    expect(await store.get(note.id)).toEqual(note);
    expect(await transaction(readIndex)).toEqual(before);
    store.close();
  });
  it("fences stale editor drafts after materializing a remote edit", async () => {
    const { store, transaction } = await enrolled();
    const note = await store.create(input);
    await transaction((engine) => {
      const index = readIndex(engine),
        id = crypto.randomUUID();
      const edit: Edit = {
        id,
        root: note.id,
        parent: index.aliases[note.id]!.head,
        note: { ...note, title: "Remote title" },
      };
      engine.stage(
        index.zone,
        "orbyn_note_edit_v1",
        id,
        JSON.stringify({
          edit: { value: edit, stamp: JSON.parse(engine.tick(Date.now())) },
        }),
      );
      index.events[id] = index.zone;
      saveIndex(engine, index);
    }, true);
    expect((await store.get(note.id))?.title).toBe("Remote title");
    await expect(
      store.update(note.id, { title: "Stale visible draft" }, note.revision),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    store.close();
  });
  it("cannot use the sync owner after account lock", async () => {
    const { store, transaction } = await enrolled();
    lock();
    await expect(transaction(readIndex)).rejects.toThrow();
    store.close();
  });
});
