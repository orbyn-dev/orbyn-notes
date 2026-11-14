# Settings shell verification

Design owner: Orbyn Designs revision `04977bac78f788f54ddadbe6d47d68960c4e470d`, Notes blob `706a8d07e5ccfb77850f4a490ab38e0c90a31a04`; frames `settings-general`, `settings-editor`, `settings-data`.

Run Vite from `web`, then `node tests/integration/settings-shell-browser.mjs`.
`NOTES_PREVIEW_URL` selects the server (default port 5195); `NOTES_UI_OUTPUT` selects evidence output. Optional `NOTES_DESIGN_HTML` measures and captures the authorized reference artifact alongside the candidate.

The disposable fixture mounts the production SettingsView and Dialog with real preference hooks and synthetic long account text. Callback receipts verify UI wiring only; existing `settings.test.tsx` verifies Workspace export/erase confirmation and focus return. Existing `study-settings.test.tsx` verifies guarded section/Done navigation.

The browser driver checks Light/Dark/Dim at 1160px, narrow containment at 899px and 390px, heading/nav/row/segment/switch geometry, keyboard focus, Editor/theme/motion persistence and Planned controls. It captures screenshots and measurements. Screenshots disable incidental transitions; motion parity is a separate issue. Native desktop behavior and backend actions are outside this fixture.
