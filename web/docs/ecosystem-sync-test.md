# Notes ↔ Planner local sync test

This is an opt-in development build, not a production release. The normal build
and the account-free workspace retain their existing behavior.

## Run

Build Notes with `VITE_ECOSYSTEM_SYNC=1`, `VITE_ENGINE_URL` pointing to the local
Engine, and `VITE_PLANNER_URL` pointing to the trusted Planner app origin. Build
Planner with the same Engine URL, `VITE_ECOSYSTEM_SYNC=1`, and `VITE_NOTES_URL`.
Allow both loopback origins in the local Engine's CORS configuration.

Sign in to the same account in both apps. Approve Notes from an already trusted
Planner device and compare the security digits on both devices. Each app keeps
its own keys, device identity, database and content; no account-free library is
copied or enrolled. Notes keeps its HTTP token in memory. After reopening, use
the **Sign in to sync** link to resume network sync; retained local access still
opens saved notes offline.

Create and save a note, choose **Link a task**, and select an existing Planner
task. Its chip opens Planner. The Planner task's Notes section opens the note.
Links check the current account, and app destinations come from build settings,
never from remotely supplied URLs.

## Ownership and persistence

- The existing library writer atomically commits a note and its immutable edit
  event in the same encrypted IndexedDB snapshot. A failed local commit leaves
  both unchanged. Editor revisions remain local compare-and-swap fences.
- Each Notes device owns `notes-sync:<device UUID>` and
  `notes-links:<device UUID>`. Only these two owned zones are uploaded. The local
  library, collections, history and approval zones are never uploaded.
- Notes reads Planner list/task records without writing task content. Planner
  reads relationship references and the cached note title, and skips note-body
  zones. Relationship payloads contain account/note/task IDs, the task zone,
  a cached note title, and active state.
- Immutable edit events reference their causal parent. Concurrent heads produce
  deterministic separate notes rather than replacing one another. Full event
  ancestry is retained. Malformed/orphan events never erase existing local notes.
- Network I/O stays outside the IDB transaction. The Engine upload batch is
  committed before sending and reused after an unknown outcome. The driver checks
  account/session and close fences before applying responses.
- **Saved** means the encrypted local commit succeeded. **Synced** means the
  driver's captured pending batches were acknowledged. Later local edits may
  still be waiting for its next pass. Missing device keys are shown separately.

## Deliberate test limits

- Web builds only; installed Windows apps are unchanged.
- Notes title/body/tags and trash state sync. Journal, Study, Clips, pins, history,
  tag-management metadata and library preferences remain local.
- The test is append-only, limited to 4,096 edit events and about 190 KB per edit.
  Permanent deletion/erase of an enrolled library is blocked. Export local copies
  before testing larger libraries. No event compaction or cloud erase is shipped.
- A removed device pauses Notes sync rather than continuing under keys it held.
  Production key rotation/revocation qualification remains required.
- The picker supports existing tasks only, including Planner's stable Inbox ID.
  Events, unlinking, permission UI, and automatic refresh of cached backlink titles
  after a note rename are not part of this test slice.
- This is self-reviewed development code, not independently security reviewed or
  qualified for production. No Engine API or encryption format was changed.

## Verification scope

Run Notes TypeScript checking, sync model/protocol tests, real-WASM storage tests,
and account tests. Run Planner TypeScript, lint/import-boundary checks, protocol
tests and the affected sync tests. Browser acceptance uses a real Engine,
PostgreSQL, SMTP verification and separate persistent device profiles; synthetic
fixture screens do not count as sync proof.
