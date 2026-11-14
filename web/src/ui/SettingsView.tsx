import { useRef, useState } from "react";
import {
  Download,
  Layers,
  Settings,
  Type,
  RefreshCw,
  Sun,
  Plug,
} from "lucide-react";
import { StudySettingsPanel } from "./StudySettingsPanel";
import type {
  StudySettingsOwner,
  SettingsLeaveGuard,
} from "./studySettingsTypes";
import type { Theme, usePreferences } from "./primitives";
import { useEditorPreferences } from "./editorPreferences";

export function SettingsView({
  email,
  preferences,
  onSignOut,
  onExport,
  onErase,
  onOpenJournal,
  onDone,
  onSetup,
  setupUnavailable = false,
  studyOwner = { status: "unavailable" },
  onStudyGuardReady,
}: {
  studyOwner?: StudySettingsOwner;
  onStudyGuardReady?: (guard: SettingsLeaveGuard | null) => void;
  onSetup?: () => void;
  setupUnavailable?: boolean;
  email: string;
  preferences: ReturnType<typeof usePreferences>;
  onSignOut: () => void;
  onExport: () => void;
  onErase: () => void;
  onOpenJournal?: () => void;
  onDone: () => void;
}) {
  const [section, setSection] = useState<
    "general" | "editor" | "sync" | "study" | "journal" | "apps" | "data"
  >("general");
  const editor = useEditorPreferences();
  const studyGuard = useRef<SettingsLeaveGuard | null>(null);
  function leave(action: () => void) {
    if (studyGuard.current) studyGuard.current.requestLeave(action);
    else action();
  }
  function registerGuard(guard: SettingsLeaveGuard | null) {
    studyGuard.current = guard;
    onStudyGuardReady?.(guard);
  }
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="Settings sections">
        {(
          [
            ["general", "General", Settings, false],
            ["editor", "Editor", Type, false],
            ["sync", "Sync", RefreshCw, true],
            ["study", "Study", Layers, false],
            ["journal", "Journal", Sun, false],
            ["apps", "Connected apps", Plug, true],
            ["data", "Data and export", Download, false],
          ] as const
        ).map(([id, label, Icon, planned]) => (
          <button
            key={id}
            aria-current={section === id ? "page" : undefined}
            onClick={() => leave(() => setSection(id))}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{label}</span>
            {planned && (
              <>
                {" "}
                <small className="settings-planned">Planned</small>
              </>
            )}
          </button>
        ))}
      </nav>
      <div
        className={
          section === "study"
            ? "settings-pane settings-study-pane"
            : "settings-pane"
        }
      >
        <header className="settings-heading">
          <h3>
            {
              {
                general: "General",
                editor: "Editor",
                sync: "Sync",
                study: "Study",
                journal: "Journal",
                apps: "Connected apps",
                data: "Data and export",
              }[section]
            }
          </h3>
          <button onClick={() => leave(onDone)}>Done</button>
        </header>
        <div className="settings-content">
          {section === "general" ? (
            <>
              <div className="settings-row">
                <div>
                  <b>Account</b>
                  <small>{email}</small>
                </div>
                <button onClick={onSignOut}>Sign out</button>
              </div>
              <div className="settings-row">
                <b>Plan</b>
                <span>Planned</span>
              </div>
              {onSetup && (
                <div className="settings-row">
                  <div>
                    <b>Set up Notes</b>
                    <small>
                      {setupUnavailable
                        ? "Finish the current note-link request first."
                        : "Optional import and local storage setup."}
                    </small>
                  </div>
                  <button disabled={setupUnavailable} onClick={onSetup}>
                    Set up Notes
                  </button>
                </div>
              )}
              <div className="settings-row">
                <div>
                  <b>Appearance</b>
                </div>
                <div
                  className="settings-segments"
                  role="group"
                  aria-label="Appearance"
                >
                  {(["system", "light", "dark", "dim"] as Theme[]).map(
                    (value) => (
                      <button
                        key={value}
                        aria-pressed={preferences.theme === value}
                        onClick={() => preferences.setTheme(value)}
                      >
                        {value[0]?.toUpperCase()}
                        {value.slice(1)}
                      </button>
                    ),
                  )}
                </div>
              </div>
              <div className="settings-row">
                <div>
                  <b>Motion</b>
                </div>
                <div
                  className="settings-segments"
                  role="group"
                  aria-label="Motion"
                >
                  {["system", "on", "reduced"].map((value) => (
                    <button
                      key={value}
                      aria-pressed={preferences.motion === value}
                      onClick={() => preferences.setMotion(value)}
                    >
                      {value[0]?.toUpperCase()}
                      {value.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <b>Language</b>
                <div>
                  <span>English</span>
                  <small>More languages · Planned</small>
                </div>
              </div>
              <div className="settings-row">
                <b>Open at login</b>
                <span>Planned</span>
              </div>
              <div className="settings-row">
                <b>Week starts on</b>
                <span>Planned</span>
              </div>
            </>
          ) : section === "editor" ? (
            <>
              <div className="settings-row">
                <b>Font</b>
                <span>Geist</span>
              </div>
              <div className="settings-row">
                <b>Text size</b>
                <div
                  className="settings-segments"
                  role="group"
                  aria-label="Text size"
                >
                  {(["small", "medium", "large"] as const).map((size) => (
                    <button
                      key={size}
                      aria-pressed={editor.preferences.textSize === size}
                      onClick={() => editor.setPreferences({ textSize: size })}
                    >
                      {size.charAt(0).toUpperCase() + size.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="settings-row">
                <b>Line width</b>
                <div
                  className="settings-segments"
                  role="group"
                  aria-label="Line width"
                >
                  {(["narrow", "wide"] as const).map((width) => (
                    <button
                      key={width}
                      aria-pressed={editor.preferences.lineWidth === width}
                      onClick={() =>
                        editor.setPreferences({ lineWidth: width })
                      }
                    >
                      {width.charAt(0).toUpperCase() + width.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="settings-row settings-toggle">
                <span>
                  <b>Turn Markdown into formatting while typing</b>
                  <small>Type ## and a space to make a heading</small>
                </span>
                <input
                  type="checkbox"
                  checked={editor.preferences.markdown}
                  onChange={(event) =>
                    editor.setPreferences({ markdown: event.target.checked })
                  }
                />
              </label>
              <label className="settings-row settings-toggle">
                <b>Check spelling</b>
                <input
                  type="checkbox"
                  checked={editor.preferences.spellcheck}
                  onChange={(event) =>
                    editor.setPreferences({ spellcheck: event.target.checked })
                  }
                />
              </label>
              <div className="settings-row">
                <div>
                  <b>Show “Linked from” beside notes</b>
                  <small>
                    Planned · Opening backlinks by default isn’t available yet.
                    Use Links and backlinks in a note.
                  </small>
                </div>
                <input
                  type="checkbox"
                  aria-label="Show Linked from beside notes"
                  disabled
                />
              </div>
              <div className="settings-row">
                <b>Open task and event chips in</b>
                <span>Orbyn Planner · Planned</span>
              </div>
            </>
          ) : section === "sync" || section === "apps" ? (
            <div className="settings-row">
              <div>
                <b>Planned</b>
                <small>
                  {section === "sync"
                    ? "Notes stay on this device in this beta."
                    : "Connections to other apps and browser extensions aren’t available in this beta."}
                </small>
              </div>
            </div>
          ) : section === "journal" ? (
            <>
              <div className="settings-row">
                <b>Lock Journal with</b>
                <span>A separate passphrase</span>
              </div>
              <div className="settings-row">
                <b>Lock after</b>
                <span>1 minute away</span>
              </div>
              <div className="settings-row">
                <b>Evening reminder</b>
                <span>Planned</span>
              </div>
              <div className="settings-row">
                <div>
                  <b>Prompts and habits</b>
                  <small>Open Journal to manage prompts and habits.</small>
                  <small>
                    In Journal, choose Journal settings from its menu.
                  </small>
                </div>
                <button
                  disabled={!onOpenJournal}
                  onClick={() => onOpenJournal && leave(onOpenJournal)}
                >
                  Open Journal
                </button>
              </div>
            </>
          ) : section === "study" ? (
            <StudySettingsPanel
              owner={studyOwner}
              onGuardReady={registerGuard}
            />
          ) : (
            <>
              <div className="settings-row">
                <div>
                  <b>Export all notes</b>
                  <small>
                    Local only. Clearing browser data removes your notes. Export
                    a copy first.
                  </small>
                </div>
                <button onClick={onExport}>Export all notes</button>
              </div>
              <div className="settings-row">
                <div>
                  <b>Export Journal</b>
                  <small>
                    Open Journal, then choose Export Journal from its menu.
                  </small>
                </div>
                <button
                  disabled={!onOpenJournal}
                  onClick={() => onOpenJournal && leave(onOpenJournal)}
                >
                  Open Journal to export
                </button>
              </div>
              <div className="settings-row">
                <div>
                  <b>Erase this browser</b>
                </div>
                <button className="danger" onClick={onErase}>
                  Erase this browser
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
