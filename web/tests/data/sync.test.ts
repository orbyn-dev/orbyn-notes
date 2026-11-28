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
import {
  NOTES_ZONE,
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
describe("real engine sync persistence", () => {
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
