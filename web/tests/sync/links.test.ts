import { describe, it, expect } from "vitest";
import { parseTaskLink } from "../../src/sync/cycle";
const accountId = "11111111-1111-4111-8111-111111111111",
  taskId = "22222222-2222-4222-8222-222222222222";
const raw = (patch = {}) =>
  JSON.stringify({
    record_type: "orbyn_note_task_link_v1",
    fields: {
      link: {
        value: {
          accountId,
          taskId,
          noteId: "note",
          taskZone: "list:inbox",
          noteTitle: "Title",
          active: true,
          ...patch,
        },
      },
    },
  });
describe("cross-app relationship contract", () => {
  it("supports Planner’s existing stable Inbox identity", () => {
    expect(
      parseTaskLink(taskId, "notes-links:" + taskId, raw(), accountId)
        ?.taskZone,
    ).toBe("list:inbox");
  });
  it("rejects another account and malformed task destinations", () => {
    expect(
      parseTaskLink(
        taskId,
        "notes-links:" + taskId,
        raw({ accountId: taskId }),
        accountId,
      ),
    ).toBeNull();
    expect(
      parseTaskLink(
        taskId,
        "notes-links:" + taskId,
        raw({ taskZone: 123 }),
        accountId,
      ),
    ).toBeNull();
  });
});
