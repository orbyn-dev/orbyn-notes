# Study settings design verification

Issue #71 follows the `settings-study` frame, design revision
`04977bac78f788f54ddadbe6d47d68960c4e470d`, Notes artifact blob
`706a8d07e5ccfb77850f4a490ab38e0c90a31a04` (unchanged from the issue's
original design revision).

The shared `srow` rules specify contiguous rows, 52px minimum height,
8px vertical padding, regular-weight labels and a 2px label/helper gap.
Study fields remain 100×32px with an 8px radius; switches remain 30×18px.
The reminder sits between daily limits and day start; remaining planned rows
follow the working switches. Beta helpers, actual saved values, validation,
recovery and Save/Cancel remain available. Unavailable integrations retain
their Planned labels rather than prototype controls.

From `web`, run the existing guarded-form tests and production checks:

```sh
npm run check
npm test -- tests/ui/study-settings.test.tsx tests/ui/settings.test.tsx
npm run build
```

Start Vite on a free port (5196 by default for the new driver), then run:

```sh
node tests/integration/study-settings-design-browser.mjs
node tests/integration/study-settings-browser.mjs
```

Both drivers accept `NOTES_PREVIEW_URL` and `NOTES_UI_OUTPUT`; set the URL
explicitly because the older persistence driver defaults to port 5179.
The new driver optionally accepts `NOTES_DESIGN_REFERENCE`, a locally supplied
current design HTML source. With it, computed source label, helper, border,
field colors and dimensions are compared directly in each theme. Without it,
only the pinned geometry/typography assertions run. Do not check the private
artifact into this repository.

The design driver checks Light, Dark and Dim at actual CSS viewport widths
1160, 640, 390 and 320px, contiguous row bounds, designed order, keyboard
switch input, visible field focus, confirmed cancellation, and synthetic
long-copy containment. Screenshots and measurements are written to the output
directory. Its zero-gap assertion fails with the original 12px-gap stylesheet.
It uses the existing disposable encrypted browser fixture and confirms that
layout/keyboard cancellation leaves preferences, cards and events unchanged.

The existing browser journey covers persistence/reopen, validation, independent
CAS conflicts and reload, dirty-value disclosure, cancel/leave, owner erasure
and a held review with grade/Undo. Existing unit coverage additionally exercises
failed/unknown writes, retry, account lock, replacement owners and held operations.
These checks cover the web Study panel. Native platform behavior and the shared
Settings shell are outside this slice; screenshots are not whole-screen parity
claims because beta help and guarded persistence controls remain intentionally.
