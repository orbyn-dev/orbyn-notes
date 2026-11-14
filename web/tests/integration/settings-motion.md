# Settings motion verification

Issue #74 builds on #77 → #75. Design revision `04977bac78f788f54ddadbe6d47d68960c4e470d`; Notes blob `706a8d07e5ccfb77850f4a490ab38e0c90a31a04`, Motion blob `aed675f375329dcf925da4d1b2a2d3b290887027`. Frames: `settings`, `toggle`, `segmented`, and the Notes Settings categories. The reference belongs to Orbyn. This slice matches motion and preserves the reviewed shell geometry.

## Scope and lifecycle

- Only the existing Study leave continuation admits navigation. Dirty/working refusals leave selection and pane unchanged. Done remains available and uses the same guard.
- Presence holds current/outgoing pane metadata, with distinct instance IDs, an opaque owner generation, phase, and numeric opacity/translation. It renders current props; no captured React trees, private values, or cloned DOM. Initial render is stable. At most two panes and one Study form exist.
- Accepted navigation immediately focuses the destination navigation button. Outgoing content is inert and hidden from accessibility; incoming controls stay inert until entry completes. Done is outside both animated panes. Journal credential autofocus and the Workspace gateway remain with their existing owner.
- A delayed entry with zero opacity is discarded when superseded. A visible entry continues its exit from measured numeric presentation. An outgoing Study instance retires before mounting a replacement Study.
- Each Study guard lease belongs to its pane instance and owner generation. Late cleanup cannot clear another lease. Continuations require the same live instance/generation. Completion requires its live element/effect; obsolete promise resolutions and nested animation events have no authority. A missing completion has a presentation-only fallback.
- Account/device/email/store changes, lock, collection close/epoch invalidation, and unmount retire old exits and cancel pane animations. The actual Study owner retains its own synchronous revocation subscription. Motion-policy changes settle the current pane without remounting Study or losing its draft.
- The existing `preferences.motion` resolves On independently of OS Reduce; Reduced always reduces; System/unknown follows the current media query. A local attribute aligns controls with that policy. Preference storage, Study persistence, scheduler/domain code, shared Dialog, and Journal ownership are unchanged.

## Motion contract

| Part | Full | Reduced |
| --- | --- | --- |
| Navigation highlight | transform 200ms, enter easing | jump |
| Pane entry | opacity 0→1 / Y 6→0, 240ms, delay 60ms | opacity 150ms, no delay or translation |
| Pane exit | opacity 1→0 / Y 0→6, 170ms | opacity 150ms, no translation |
| Segmented thumb / label | transform 200ms / color 150ms | thumb jumps / color 150ms |
| Switch knob / track | transform 150ms / color 150ms | knob jumps / color 150ms |

Enter easing: `cubic-bezier(.2,.8,.2,1)`. Exit, reduced fade, and color easing: `cubic-bezier(.4,0,.2,1)`. Notes switches are 30×18px with a 14px knob, 2px inset, and 12px travel; the Motion demo's larger switch has different travel.

## Run and evidence

Run the existing Vite fixture routes, or include `index.html`, `tests/integration/settings-shell-browser.html`, and `tests/integration/study-settings-browser.html` as production build inputs. Then run:

```sh
NOTES_PREVIEW_URL=http://127.0.0.1:5198 NOTES_UI_OUTPUT=<ignored-output> node tests/integration/settings-motion-browser.mjs
```

Optional `NOTES_MOTION_REFERENCE` points to the authorized local Motion artifact. The driver compares computed reference timings/easing and records actual candidate Web Animation/CSS transition properties, controlled intermediate pane samples/screenshots, switch geometry, and navigation indicator geometry. It exercises real preference writes/reload, three themes at 1160/899/390 CSS pixels with long synthetic account text, explicit On + OS Reduce, System media changes, Reduced, policy change during entry, and the real encrypted local Study save/discard → Journal focus → lock flow. Output: `measurements.json` and PNGs, with browser page errors required to be empty.

Reference inspection uses a separate browser context with document JavaScript disabled, service workers blocked, offline mode, and all network routes aborted. Raw HTML stays intact; trusted synchronous Playwright evaluation reads its computed styles. The application's JavaScript-enabled context is separate. `inert-reference.test.ts` checks this context policy and cleanup in the normal unit suite. Every motion-driver run also exercises six adversarial reference cases and a legitimate CSS control in Chromium. Run that browser boundary alone with `node tests/integration/inert-reference-browser.mjs`; it requires zero source execution/network requests and closes every reference context.

Deterministic tests add delayed/visible interruption, obsolete lease/completion cleanup, missing-completion fallback, outgoing action/focus isolation, StrictMode, and synchronous owner close/epoch/lock cases. The initial nine motion tests failed against the parent implementation before passing with this slice. Existing Settings, navigation, Study, Journal-owner, and session tests remain unmodified.

Local browser results: durations/easing matched the contract; switches measured 30×18/14px/2px with 12px travel; highlight bounds matched selected navigation bounds (0px difference) across all nine theme/width combinations. Real Study save persisted and discard preserved the saved value. Lock immediately left zero outgoing panes, Study fields, or pane animations; the App then removed Settings. Native desktop behavior, sustained frame rate, LCP, and whole-screen pixel parity are unverified. The browser measurements do not establish a native 60fps claim. Clean-export and independent Study presentation compatibility verification belong to the batch coordinator.

Separate review round 1 found that global reduced-motion resets suppressed label/track color feedback. Settings-scoped overrides now retain the source's 150ms color transitions in Reduced/System + OS Reduce, with thumb motion disabled. Reduced pane keyframes use `transform: none` exactly. Browser regressions inspect computed reduced navigation/segment/Notes/Study transition properties, exercise actual label/track transitions, block outgoing native focus/click, and close through Done during entry.
