import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  LibrarySnapshot,
  NotesLibrary,
  Tag,
} from "../../src/library/contracts";
import { CardSearchPreview } from "../../src/ui/CardSearchPreview";
import { TagsView } from "../../src/ui/TagsView";

const updatedAt = "2026-11-11T00:00:00Z";

function tag(id: string, name: string): Tag {
  return {
    id,
    name,
    color: null,
    revision: 1,
    createdAt: updatedAt,
    updatedAt,
    state: "active",
    mergedInto: null,
  };
}

function snapshot(tags: Tag[]): LibrarySnapshot {
  return {
    token: { epoch: "epoch-1", revision: 2 },
    notes: [],
    tags,
    metadata: [],
    preferences: { sort: "edited" },
  };
}

function renderTags(tags: Tag[]) {
  return render(
    <TagsView
      library={{} as unknown as NotesLibrary}
      snapshot={snapshot(tags)}
      onResult={vi.fn()}
      reload={async () => snapshot(tags)}
      onOpenTag={vi.fn()}
    />,
  );
}

function renderPreview(front: string) {
  return render(
    <CardSearchPreview
      input={{ type: "basic", key: "basic:forward", front, back: "Answer" }}
      deckTitle="Synthetic deck"
      isCurrent={() => true}
      scopeVersion={1}
      onClose={vi.fn()}
      onBack={vi.fn()}
    />,
  );
}

beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});

describe("tags header count", () => {
  it("uses the singular for one active tag", () => {
    renderTags([tag("tag-1", "Trip")]);
    expect(screen.getByText("1 tag")).toBeInTheDocument();
    expect(screen.queryByText("1 tags")).not.toBeInTheDocument();
  });

  it("keeps a plural count for several active tags", () => {
    renderTags([tag("tag-1", "Trip"), tag("tag-2", "Study")]);
    expect(screen.getByText("2 tags")).toBeInTheDocument();
    expect(screen.queryByText("2 tag")).not.toBeInTheDocument();
  });
});

describe("card preview range count", () => {
  it("uses the singular when the card side holds one character", async () => {
    renderPreview("Q");
    const dialog = await screen.findByRole("dialog", { name: "Card" });
    await waitFor(() =>
      expect(dialog.querySelector(".search-card-range")?.textContent).toBe(
        "1–1 of 1 character",
      ),
    );
  });

  it("keeps a plural count for longer card text", async () => {
    renderPreview("Hello");
    const dialog = await screen.findByRole("dialog", { name: "Card" });
    await waitFor(() =>
      expect(dialog.querySelector(".search-card-range")?.textContent).toBe(
        "1–5 of 5 characters",
      ),
    );
  });
});
