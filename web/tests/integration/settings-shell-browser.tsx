// UI boundary fixture with real device preference hooks; no account or data writes.
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { SettingsView } from "../../src/ui/SettingsView";
import { Dialog, usePreferences } from "../../src/ui/primitives";
import "../../src/styles/app.css";
import "@fontsource/geist/400.css";
import "@fontsource/geist/500.css";
function Fixture() {
  const preferences = usePreferences();
  const [lastAction, setLastAction] = useState("none");
  return (
    <>
      <Dialog
        title="Settings"
        className="settings-dialog"
        onClose={() => setLastAction("done")}
      >
        <SettingsView
          email={`${"long-synthetic-account".repeat(6)}@example.invalid`}
          preferences={preferences}
          onSignOut={() => setLastAction("signout")}
          onSetup={() => setLastAction("setup")}
          onExport={() => setLastAction("export")}
          onErase={() => setLastAction("erase")}
          onDone={() => setLastAction("done")}
        />
      </Dialog>
      <output aria-label="Fixture callback">{lastAction}</output>
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
