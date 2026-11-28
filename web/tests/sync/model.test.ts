import { describe, it, expect } from "vitest";
import { projectEdits, type Edit } from "../../src/sync/model";
const note = (title: string) => ({
  id: "n",
  title,
  document: { type: "doc" as const, content: [{ type: "paragraph" }] },
  tags: [],
  createdAt: "2026-11-28T00:00:00.000Z",
  updatedAt: "2026-11-28T00:00:00.000Z",
  trashedAt: null,
  revision: 1,
});
const edit = (id: string, parent: string | null, title = id): Edit => ({
  id,
  parent,
  root: "n",
  note: note(title),
});
describe("encrypted note causal projection", () => {
  it("handles the full retained event limit without recursive stack growth", () => {
    const edits = Array.from({ length: 4096 }, (_, i) =>
      edit(String(i), i ? String(i - 1) : null),
    );
    expect(projectEdits(edits).notes[0]?.title).toBe("4095");
  });
  it("treats opaque note IDs as data rather than object properties", () => {
    const first = { ...edit("a", null), root: "__proto__" };
    expect(Object.hasOwn(projectEdits([first]).aliases, "__proto__")).toBe(
      true,
    );
  });
  it("preserves concurrent edits and converges regardless of arrival order", () => {
    const edits = [edit("a", null), edit("b", "a"), edit("c", "a")];
    const a = projectEdits(edits),
      b = projectEdits([...edits].reverse());
    expect(a).toEqual(b);
    expect(a.notes.map((n) => [n.id, n.title])).toEqual([
      ["n", "b"],
      ["c", "c"],
    ]);
  });
  it("continues editing the conflict copy on its own branch", () => {
    const result = projectEdits([
      edit("a", null),
      edit("b", "a"),
      edit("c", "a"),
      edit("d", "c"),
    ]);
    expect(result.notes.map((n) => [n.id, n.title])).toEqual([
      ["n", "b"],
      ["c", "d"],
    ]);
    expect(result.aliases.c).toEqual({ root: "n", head: "d" });
  });
  it("does not materialize orphan or cyclic events", () => {
    expect(
      projectEdits([edit("a", "missing"), edit("b", "c"), edit("c", "b")])
        .notes,
    ).toEqual([]);
  });
  it("preserves trash and restore in causal order", () => {
    const b = edit("b", "a");
    b.note.trashedAt = "2026-11-28T00:00:00.000Z" as never;
    expect(projectEdits([edit("a", null), b]).notes[0]?.trashedAt).toBeTruthy();
    expect(
      projectEdits([edit("a", null), b, edit("c", "b")]).notes[0]?.trashedAt,
    ).toBeNull();
  });
});
