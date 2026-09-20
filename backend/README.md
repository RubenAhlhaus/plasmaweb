# Python Backend (FastAPI + WebSocket, Message-Contract v1)

Das Backend ist auf eine modulare Struktur umgestellt:
- klarer Message-Contract (Pydantic)
- WebSocket-Transport getrennt von Business-Logik
- CommandBus/Handler-Pattern statt großem `if/elif`-Block

## Aktuelle Struktur

| Modul | Aufgabe |
|-------|---------|
| `backend/main.py` | App-Wiring, Lifecycle, optional statisches `dist/` unter `/` |
| `backend/frontend_static.py` | Mount der Vite-Produktions-UI (`index.html`/`lcncgui-config.json`: kein Browser-Cache; `assets/*`: immutable) |
| `backend/api/ws.py` | WebSocket-Endpunkt (`parse → dispatch → respond`), Backend-Stop nach `app.exit` |
| `backend/api/user_preferences.py` | REST für launcher-sichtbare UI-Preferences (Kiosk vs. Fenster) |
| `backend/api/hal_tools.py` | REST zum Starten von HAL-Hilfsprogrammen (HAL Show, HAL Meter, …) |
| `backend/hal_tools.py` | Kommando-Auflösung und detached Start (gmoccapy-Parität) |
| `backend/linuxcnc_autostart.py` | XDG-Autostart-Desktop-Eintrag für LinuxCNC beim grafischen Login |
| `backend/user_preferences.py` | Lesen/Schreiben von `user-preferences.json` auf Disk |
| `backend/shutdown.py` | System-Shutdown für `app.exit` mit `shutdown: true` (Maschine aus, Marker, verzögertes Poweroff) |
| `backend/launcher_prefs.py` | Kiosk-Auflösung für `bin/lcncgui` |
| `backend/contracts/messages.py` | Contract-Modelle (Command/Ack/Event/Completion) |
| `backend/application/command_bus.py` | Routing `(category, action) → handler` |
| `backend/handlers/` | Kategorie-Handler (`machine`, `motion`, `program`, `app`, …) |
| `backend/adapters/linuxcnc_gateway.py` | LinuxCNC-Gateway (stat, command, Dateizugriff) |
| `backend/services/status_publisher.py` | Periodische Status-Events |
| `backend/coordinate_systems.py` | G5x-Offsets, Koordinatensystem-Liste für Status/MDI |

## WebSocket-Endpunkt

- URL: `ws://localhost:8765/ws`

## User preferences (REST)

Launcher-sichtbare Einstellungen aus der Settings-UI (nicht über den WebSocket-Command-Bus):

| Methode | Pfad | Body / Response |
|---------|------|-----------------|
| `GET` | `/api/user-preferences` | `{ "kioskMode": true \| false \| null, "runLinuxCncAtStartup": boolean, "linuxCncIniPath": string \| null }` |
| `PUT` | `/api/user-preferences` | Body: `{ "kioskMode": true \| false }` — schreibt `~/.local/share/lcncgui/user-preferences.json` (Override: `LCNCGUI_USER_PREFERENCES`) |
| `PUT` | `/api/user-preferences/linuxcnc-autostart` | Body: `{ "runLinuxCncAtStartup": boolean }` — speichert Autostart-Präferenz und legt/entfernt `~/.config/autostart/linuxcnc-lcncgui.desktop` |

Priorität beim Start in `bin/lcncgui`: `LCNCGUI_KIOSK` (falls gesetzt) → Datei (`kioskMode`, legacy `kiosk`) → `ui.kioskMode` in `dist/lcncgui-config.json` → Standard Kiosk.

## HAL tools (REST)

Settings-UI startet LinuxCNC-Hilfsprogramme auf dem Backend-Host (gmoccapy-Parität):

| Methode | Pfad | Body / Response |
|---------|------|-----------------|
| `POST` | `/api/hal-tools/launch` | Body: `{ "tool": "halshow" \| "halmeter" \| "halscope" \| "linuxcnctop" \| "hal_calibration" \| "classicladder" }` — Response: `{ "ok": true }` oder HTTP **422** (Voraussetzung fehlt) / **503** (Launch-Fehler) mit `{ "detail": { "code", "message" } }` |

Siehe `docs/features/12_HAL_TOOLS_SETTINGS.md`.

Details: [`docs/features/08_WINDOW_MODE.md`](../docs/features/08_WINDOW_MODE.md), [`docs/installation.md`](../docs/installation.md).

## Message-Contract (v1)

Siehe [`docs/backend-frontend-messages.md`](../docs/backend-frontend-messages.md) und [`docs/commands-events.md`](../docs/commands-events.md).

Kurzüberblick:

### Inbound Command (Frontend → Backend)

```json
{
  "type": "command",
  "protocolVersion": 1,
  "commandId": "cmd-1",
  "category": "machine",
  "action": "power",
  "params": { "on": true }
}
```

### Outbound Ack (Backend → Sender)

```json
{
  "type": "command_result",
  "protocolVersion": 1,
  "commandId": "cmd-1",
  "ok": true
}
```

Async-Kommandos (z. B. `program.run`) antworten zuerst mit `"asyncPending": true`; Abschluss folgt als `command_completion` mit derselben `commandId`.

### Outbound Event (Backend → Clients)

Periodisches Status-Event:

```json
{
  "type": "linuxcnc_status",
  "protocolVersion": 1,
  "event": "status.snapshot",
  "payload": { "machine": { "powerOn": true } }
}
```

## Implementierte Command-Kategorien (Auswahl)

| Kategorie | Aktionen (Auswahl) |
|-----------|-------------------|
| `machine` | `power`, `set_task_state`, `flood`, `spindle`, `abort`, … |
| `motion` | `jog`, `home`, `set_active_coordinate_system`, … |
| `program` | `list`, `read`, `write`, `run`, `pause`, `mdi`, … |
| `app` | `exit` (optional `{ "shutdown": true }`) |

Neue Commands folgen demselben Handler-Muster in `backend/handlers/`.

## Start des Backends

### Entwicklung (Repo)

```bash
pip install -r backend/requirements.txt   # inkl. pytest
python -m backend.main                    # oder: uvicorn backend.main:app --reload --host 0.0.0.0 --port 8765
```

Vite-Dev (`npm run dev`) und Backend laufen getrennt — `public/lcncgui-config.json` braucht eine **explizite** WebSocket-URL, z. B. `ws://127.0.0.1:8765/ws` (Vorlage: `public/lcncgui-config.example.json`).

### Produktion / LinuxCNC `[DISPLAY]`

Siehe **[`docs/installation.md`](../docs/installation.md)**. Kurz:

- `install.sh` legt `/opt/lcncgui/venv` an (`requirements-runtime.txt`, `--system-site-packages` für `linuxcnc`)
- `bin/lcncgui` startet Uvicorn + Browser; LinuxCNC ruft `lcncgui -ini …` auf
- Wenn `dist/index.html` existiert, liefert `backend/main.py` die gebaute UI unter `/` (WebSocket weiter unter `/ws`). Nach `install.sh`-Updates reicht ein LinuxCNC-Neustart: `index.html` wird nicht vom Kiosk-Chromium zwischengespeichert (siehe [`docs/installation.md`](../docs/installation.md) → Upgrading).

Umgebungsvariablen (Auswahl): `LCNCGUI_HOST` (Default-Bind `0.0.0.0` — ohne Authentifizierung im Netz erreichbar; `127.0.0.1` schränkt auf den Rechner selbst ein), `LCNCGUI_PORT`, `LCNCGUI_FRONTEND_DIST`, `LCNCGUI_DISPLAY_LAUNCH`, `LCNCGUI_USER_PREFERENCES`. Details: `backend/config.py`, `docs/installation.md`.

## Tests

```bash
pip install -r backend/requirements.txt
python -m pytest backend/tests -q
```

`backend/tests/conftest.py` isoliert `LCNCGUI_USER_PREFERENCES` pro Test. Einige Tests benötigen `linuxcnc` (Controller); viele Handler- und Contract-Tests laufen auch ohne.

Auf dem Controller reicht für den Betrieb `pip install -r backend/requirements-runtime.txt` im Install-venv.

## `coordinate_systems.py`

[`backend/coordinate_systems.py`](coordinate_systems.py) provides helpers used by the LinuxCNC gateway and motion handlers: listing systems for the status snapshot (`coordinate_systems` payload), one-time hydration of inactive G5x offsets from the RS274NGC parameter/VAR file, MDI line for `motion.set_active_coordinate_system`, and merging stored offsets after `motion.set_coordinate_system_offset`. A future refactor could move this module under `adapters/` or `domain/` for clearer layering.
