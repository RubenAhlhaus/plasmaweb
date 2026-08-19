# Web frontend: internationalization (i18n)

The renderer uses **i18next** with **react-i18next**. User-visible strings live in JSON locale files; the default language is **English** (`en`), with **German** (`de`) as an additional UI language.

## Configuration

- **Init:** [`src/i18n/config.ts`](../src/i18n/config.ts) — registers namespaces, resources (`en` / `de`), default `lng`, `react-i18next` plugin. Initialization is asynchronous (`i18nReady` promise); init failures are logged and non-fatal (`fallbackLng` still applies).
- **Bootstrap:** [`src/renderer.tsx`](../src/renderer.tsx) imports the i18n config before rendering the app.
- **Persistence:** Selected locale is stored under **`lcncgui.locale`** in `localStorage` (see [`src/i18n/constants.ts`](../src/i18n/constants.ts): `LOCALE_STORAGE_KEY`, `readStoredLocale`, `SUPPORTED_LOCALES`) only after a successful `changeLanguage` in `setAppLocale`.
- **Virtual sidebar:** Toggled in Settings; persisted under **`lcncgui.showVirtualSidebar`** in `localStorage` (see [`src/lib/uiPreferencesStorage.ts`](../src/lib/uiPreferencesStorage.ts)). Overrides `ui.showVirtualSidebar` from `lcncgui-config.json` when set.
- **Virtual sidebar hotkeys:** Assigned in Settings; persisted under **`lcncgui.virtualSidebarHotkeys`** in `localStorage` (see [`src/lib/virtualSidebarHotkeysStorage.ts`](../src/lib/virtualSidebarHotkeysStorage.ts)). Updated via `setVirtualSidebarHotkeyPreference(...)` from [`src/lib/uiPreferences.ts`](../src/lib/uiPreferences.ts). See [`docs/features/09_VIRTUAL_SIDEBAR_HOTKEYS.md`](features/09_VIRTUAL_SIDEBAR_HOTKEYS.md).
- **Window mode (kiosk vs title bar):** Selected in Settings; persisted via **`PUT /api/user-preferences`** to **`~/.local/share/lcncgui/user-preferences.json`** (field **`kioskMode`**; legacy **`kiosk`** still read on launch). Overrides `ui.kioskMode` from config when set. Takes effect after restarting lcncgui/LinuxCNC — see [`docs/features/08_WINDOW_MODE.md`](features/08_WINDOW_MODE.md).
- **LinuxCNC autostart:** Toggled in Settings; persisted via **`PUT /api/user-preferences/linuxcnc-autostart`** to **`user-preferences.json`** and **`~/.config/autostart/linuxcnc-lcncgui.desktop`** — see [`docs/features/14_LINUXCNC_AUTOSTART.md`](features/14_LINUXCNC_AUTOSTART.md).
- **Reload last tool after homing:** Toggled in Settings; last `tool_in_spindle` is saved via **`PUT /api/user-preferences/tool-in-spindle`**; after axes are homed the UI may send **`M61 Q… G43`**. See [`docs/features/17_RELOAD_TOOL_ON_STARTUP.md`](features/17_RELOAD_TOOL_ON_STARTUP.md).
- **HAL tools (Settings):** Buttons launch LinuxCNC HAL helper programs via **`POST /api/hal-tools/launch`** on the backend host; error codes are shown in the UI via `settings:halTools.errors.*` — see [`docs/features/12_HAL_TOOLS_SETTINGS.md`](features/12_HAL_TOOLS_SETTINGS.md).
- **Runtime switch:** [`src/screens/SettingsScreen.tsx`](../src/screens/SettingsScreen.tsx) offers a language control and calls `setAppLocale(...)` when the user changes the setting (`localStorage` and `document.documentElement.lang` are updated only after `changeLanguage` succeeds); the virtual sidebar toggle calls `setShowVirtualSidebarPreference(...)`; virtual sidebar hotkeys call `setVirtualSidebarHotkeyPreference(...)`; window mode calls `setKioskModePreference(...)` from [`src/lib/uiPreferences.ts`](../src/lib/uiPreferences.ts); LinuxCNC autostart calls `setLinuxCncAutostartPreference(...)`; reload-last-tool calls `setReloadToolOnStartupPreference(...)`; HAL tool buttons call `launchHalTool(...)` from [`src/lib/halToolsApi.ts`](../src/lib/halToolsApi.ts).

## Namespace layout (`src/locales/`)

Each namespace has mirrored keys in `en/` and `de/`:

| Directory / file | Typical content |
|------------------|-----------------|
| `common.json` | Shared short strings (e.g. nav, `placeholder.*` for empty screens) |
| `settings.json` | Settings screen |
| `macros.json` | Macros screen and macro UI |
| `tools.json` | Tools screen, tool edit/touch-off/table, `material.*`, `coolant.*`, … |
| `program.json` | Program-related UI |
| `hooks.json` | Strings used from hooks (e.g. jog/MDI precondition tooltips via `i18n.t` and `ns: 'hooks'`) |
| `components.json` | Reusable components (coordinates, MDI console, homing, spindle/feed dialogs, **virtual sidebar** softkey labels `virtualSidebar.*`, **jog increment selector** `jogIncrements.*`, **program path errors** `programPathErrors.*`, error toasts, …) |

Namespaces are passed explicitly where needed, e.g. `useTranslation('tools')` or `useTranslation('components')`. Some screens load several namespaces at once, e.g. `useTranslation(['program', 'components'])` in `ProgramScreen` (shared `t`: program keys resolve first; keys such as `spindleFeed.*` live in `components`). For disambiguation or overlapping key names, use the `namespace:key` form as in [`SettingsScreen.tsx`](../src/screens/SettingsScreen.tsx) (`settings:…`, `common:…`).

## Tests

Vitest resets language to English before each test (see [`src/setupTests.ts`](../src/setupTests.ts): `await i18nReady`, then `i18n.changeLanguage('en')`) so assertions and `getByRole` queries match the default locale.

## Adding strings

1. Add the key to **`src/locales/en/<namespace>.json`** (source of truth for key shape).
2. Mirror the same key in **`src/locales/de/<namespace>.json`**.
3. Use `useTranslation('<namespace>')` and `t('key')`, or `Trans` for rich text (see e.g. tool-change dialog body in `components.json`).

For strings used outside React render (e.g. in zustand-friendly hooks), the code may call `i18n.t(key, { ns: 'hooks' })` from [`src/i18n/config.ts`](../src/i18n/config.ts); ensure a parent component still re-renders on language change when those strings are shown (often via `useTranslation` on the same screen).

## Related docs

- App start and config file: [`docs/frontend-web-start.md`](frontend-web-start.md)
