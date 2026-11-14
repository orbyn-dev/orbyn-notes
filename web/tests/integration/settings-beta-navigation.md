# Settings beta navigation verification

Issue #73 builds on the reviewed Settings shell in #75. Design revision `04977bac78f788f54ddadbe6d47d68960c4e470d`, Notes blob `706a8d07e5ccfb77850f4a490ab38e0c90a31a04`; frames `settings-general`, `settings-sync`, `settings-journal`, `settings-apps`, `settings-data`.

## Scope and protected contracts

- Seven ordered categories; Sync and Connected apps are selectable Planned informational panes. General describes unavailable plan, language, startup and week-start capabilities truthfully.
- Journal facts and two navigation gateways only. Private prompts, habits, passphrases and export forms remain in the existing Journal owner. No additional vault, automatic unlock or automatic export.
- Settings leave guard runs before the Workspace navigation guard. Denial keeps Settings and its notice. Existing notes export and erase confirmation/cancellation remain intact.
- Workspace supplies an immediate focus fallback after Dialog cleanup and preserves meaningful focus assigned by the Journal owner, including its asynchronous credential autofocus. Account/device/store replacement cancels pending focus. No delayed refocus overrides user input. Narrow/hidden sidebars return to the visible navigation trigger. Normal Done/Escape retain the captured Settings opener.
- Shared Dialog, CollectionsHost, JournalView, StudySettingsPanel and data/crypto/export internals are unchanged. Pane/control motion belongs to a later issue.

## Gates

From `web`:

- `node node_modules/vitest/vitest.mjs run tests/ui/settings-beta-navigation.test.tsx tests/ui/settings.test.tsx tests/ui/study-settings.test.tsx --maxWorkers=1`
- `npm run check` and `npm run build`
- Run Vite on an unused local port, then `node tests/integration/settings-beta-navigation-browser.mjs`. Set `NOTES_PREVIEW_URL` for the server, `NOTES_UI_OUTPUT` for evidence, and optionally `NOTES_DESIGN_HTML` for the authorized source artifact.

The driver uses the existing Settings shell fixture for synthetic long email text and all seven categories at actual 1160/899/390 × 850 viewports in Light/Dark/Dim, keyboard activation, screenshots, geometry and containment. The existing disposable Study fixture supplies the real App, encrypted WASM/IndexedDB and synthetic local identity for Journal enrollment/locked/unlocked routes, guarded navigation, preservation of asynchronous credential autofocus, dirty Study keep/discard, and real notes export/erase cancellation. The driver never creates an account backend identity or uses a human profile.

Component regressions cover draft/working navigation denial and account replacement before focus handoff. Source review verifies ownership and absence of global private forms; runtime route checks do not independently qualify cryptography. Native desktop builds, account backend behavior and motion parity are unverified here.
