# 18_OVERRIDE_PRESET_HOTKEYS

## Description

Zwei 16-stellige Drehgeber (oder beliebige Tastaturquellen) können **Feed-Override** und **Spindle-Override** absolut setzen. Jede Stellung `0`–`15` bekommt in **Settings** einen eigenen Hotkey (wie die Virtual-Sidebar-Hotkeys). Beim Auslösen wird der Override auf den festen Prozentwert der Stellung gesetzt — **außer Feed-Stellung 0 bei laufendem Programm** (siehe Hybrid unten).

**Stellung → Prozent:**

| Stellung | Override |
|----------|----------|
| 0–10     | 0 %, 10 %, …, 100 % (Schritte zu 10) |
| 11–15    | 125 %, 150 %, 175 %, 200 %, 200 % (Schritte zu 25; Stellung 15 auf 200 % begrenzt) |

LinuxCNC begrenzt Feed-/Spindle-Override auf ca. **1–200 %** (`factor` 0.01–2.0).

**Feed Stellung 0 (Hybrid):** LinuxCNC erlaubt kein echtes 0 %. Deshalb:

- **Kein laufendes Programm** (Manual/MDI/Idle): Feed-Override auf das Minimum (**~1 %**, Faktor `0.01`).
- **Programm läuft** (`MODE_AUTO`, Interpreter `READING`/`WAITING`): **Program Pause** (`program.auto` / `pause`) statt Override. Ownership gilt erst, wenn der Status **`INTERP_PAUSED`** (oder `program.paused`) bestätigt — nicht schon beim Senden.
- **Verlassen von Stellung 0** nach eigener Pause: nur Presets **≤ 100 %** (10–100 %); dann Override setzen und **Resume**. Presets **> 100 %** (Encoder-Wrap auf Stellung 11–15) werden von 0 aus **ignoriert** — kein Override, kein Resume. Kommt ein erlaubtes Verlassen, bevor Pause im Status sichtbar ist, bleibt ein **Resume-Pending**; sobald Pause bestätigt ist, folgen Override (nochmals, idempotent) + Resume.
- **„Bei Feed 0“** für die Wrap-Guard: Pause-Ownership-Phase `pause_requested`/`owned`, oder zuletzt akzeptiertes Feed-Preset **≤ 0 %**, oder — falls noch kein Feed-Preset akzeptiert wurde — Status-`overrides.feedrate` **≤ ~1 %** (`0.01`).
- Manuelle Pause (Sidebar/Hotkey) wird **nicht** auto-resumed. Scheitert das Pause-Kommando (`command_result` `ok: false`), wird Ownership verworfen.

Spindle Stellung 0 setzt explizit Faktor **0.01** (~1 %), ohne Pause-Logik.

Shortcuts liegen in browser-**`localStorage`**:
- `plasmaweb.feedOverrideHotkeys`
- `plasmaweb.spindleOverrideHotkeys`

Form: `{ [position: "0"…"15"]: { key, ctrl?, alt?, shift?, meta? } }`.

Kombinationen müssen **global eindeutig** sein (gegen Virtual-Sidebar-Hotkeys und die jeweils andere Override-Gruppe).

## UI Interaction

- **Settings → Feed override hotkeys** bzw. **Spindle override hotkeys**.
- Kurzhilfe lesen, dann **Show positions 0–15** / **Stellungen 0–15 anzeigen** aufklappen.
- Pro Stellung eine Zeile mit Label z. B. `Feed position 8 → 80%` / `Feed Stellung 8 → 80 %`; **Feed Stellung 0** als `→ ~1 % / Pause` / `→ ~1% / pause`.
- Klick → Tasten drücken; Backspace/Delete löscht beim Erfassen; Escape bricht ab; **Clear** entfernt die Belegung.
- Doppelte Kombinationen werden abgelehnt (Info-Toast mit Konfliktziel).

## Preconditions

- WebSocket verbunden; Maschine typischerweise **ON** (wie bei Override im Spindle/Feed-Dialog).
- Shortcut wird nicht ausgelöst bei Fokus in `INPUT` / `TEXTAREA` / `SELECT` / `contenteditable` oder während Hotkey-Capture (`data-hotkey-capture`).
- Feed Stellung 0 → Pause: zusätzlich `MODE_AUTO` und Interpreter `READING`/`WAITING` (wie Backend `program.auto` / `pause`).

## Event order

1. Tastendruck matcht eine belegte Override-Stellung (`useGlobalHotkeyListener`).
2. Listener publiziert `ui.feed.setOverride` bzw. `ui.spindle.setOverride` mit `{ percent, source: 'hotkey' }`.
3. `useMachineEventBridge` **coalesciert** schnelle Preset-Events (latest-wins, ~50 ms Ruhe).
4. **Spindle:** `machine.spindle_override` mit `{ factor, spindle: 0 }` (`percent ≤ 0` → `factor: 0.01`).
5. **Feed:** `useMachineEventBridge` übergibt das zuletzt akzeptierte Preset an `applyFeedOverridePreset`; Status-Reaktion (`reactToFeedZeroPauseStatus`) / Pause-`command_result` (`reactToFeedZeroPauseCommandResult`):
   - **Guard von Feed-0 (in `applyFeedOverridePreset`):** ist man „bei Feed 0“ (siehe Description) und `percent > 100`, Resolution mit **leeren Commands**, unveränderter Phase und `accepted: false` (Bridge aktualisiert das letzte Preset nicht) — schützt vor Encoder-Wrap auf Stellung 11–15 (125–200 %).
   - `percent > 0` (und Guard nicht greift, `accepted: true`): `machine.feed_override`; nach bestätigter eigener Feed-0-Pause zusätzlich `program.auto` `{ command: 'resume' }` (ggf. verzögert bis Status pausiert).
   - `percent ≤ 0` und Programm läuft: `program.auto` `{ command: 'pause' }` mit `commandId`; Phase `pause_requested` bis Status `PAUSED` → `owned`.
   - `percent ≤ 0` sonst: `machine.feed_override` mit Faktor **0.01**.
6. Status-Updates aktualisieren Override-Anzeigen / Pause-Zustand wie bei Dialog bzw. Sidebar-Pause.

## User Feedback

- Belegte Shortcuts in den Settings-Feldern (lokalisierte Modifikator-Labels).
- Bei Duplikat: Info-Toast, keine Speicherung.
- Erfolgreiches Setzen: sichtbare Override-% in den Gauges/Status (kein Extra-Toast); bei Feed-0-Pause der übliche Pause-Status (Header/Sidebar).
- Fehler vom Backend: wie bei anderen Machine-Commands (globaler Error-Toast bei `command_result`), außer transientem `command_in_progress` bei Override-Presets **und** `program.auto` (kein Toast).

## Edge Cases

- **Feed Stellung 0 ohne Programm:** Override ~1 % (nicht 0 %).
- **Feed Stellung 0 mit laufendem Programm:** Pause-Kommando; Override bleibt unverändert, bis ein Preset > 0 gesendet wird.
- **Feed Stellung 0 erneut während `pause_requested` / eigener Pause:** kein zweites Pause-Kommando (bzw. No-op bei `owned`).
- **Verlassen von Feed-0 bevor Pause im Status steht:** Override sofort; Resume sobald `INTERP_PAUSED` (Resume-Pending).
- **Verlassen von Feed-0 nach `owned`:** Override + Resume.
- **Manuelle Pause, dann Feed-Preset > 0:** nur Override; **kein** Auto-Resume.
- **Manuelle Pause, dann Feed-0:** setzt ~1 % Override (Programm bleibt manuell pausiert).
- **Pause-Kommando fehlgeschlagen:** Ownership/`resume_pending` wird verworfen; kein Auto-Resume.
- **Spindle Stellung 0:** Override-Minimum (~1 %), nie Program Pause.
- **Stellung 15:** Mapping ergibt 225 %, wird auf **200 %** begrenzt.
- **Schnelles Durchdrehen:** nur der letzte Prozentwert der Coalesce-Fenster wird gesendet (kurz 0 dann 50 → nur 50, keine Pause). Die Wrap-Guard greift erst, wenn ein 0-Preset (oder äquivalenter Zero-Zustand) *akzeptiert* wurde — dreht man in einem Fenster von z. B. 10 % durch 0 auf 200 %, ohne dass 0 allein coalesciert, kann 200 % noch gesetzt werden.
- **Von Feed 0 % Encoder falschrum (Wrap auf 125–200 %):** Presets **> 100 %** werden ignoriert; von 0 % aus sind nur **10–100 %** (bzw. erneut 0 %) erlaubt. Sobald ein Preset **> 0 % und ≤ 100 %** akzeptiert wurde und keine Pause-Ownership mehr hält, sind 125–200 % wieder normal erreichbar (ein noch nicht aktualisierter Status ~1 % blockiert dann nicht). Spindle hat diese Guard nicht.
- **Bereits am Zielwert:** Backend-Noop (kein Fehler).
- **Settings-Screen / Dialoge offen:** Shortcuts bleiben aktiv (außer Textfeld/Capture).
- **Beide Encoder:** getrennte Hotkey-Maps für Feed und Spindle; gleiche physische Keys nur möglich, wenn nicht als Duplikat erkannt (also nicht parallel dieselbe Kombination).

## Errors

- Duplikat-Hotkey: nicht gespeichert; Info-Toast.
- Override / Pause / Resume fehlgeschlagen / Maschine aus: `command_result`-Fehler wie beim Dialog bzw. Programmausführung (ohne Toast bei `command_in_progress` für `machine.feed_override`, `machine.spindle_override`, `program.auto`).

## Related Features

- 09_VIRTUAL_SIDEBAR_HOTKEYS (Capture-UI, localStorage-Muster, Ignore-Regeln, gemeinsamer Listener)
- 01_JOG_HOME_SCREEN (Spindle/Feed-Gauges und Override-Dialoge)
- 06_PROGRAM_SCREEN (cycle start, pause, stop)
