import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AppTooltip } from '@/components/AppTooltip';
import { HotkeyCaptureButton } from '@/components/HotkeyCaptureButton';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { TouchSelectField } from '@/components/ui/TouchSelectField';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { PLASMAWEB_CONFIG_JSON } from '@/lib/loadPlasmawebConfig';
import type { HotkeyConflict, OverridePresetKind } from '@/lib/overridePresetHotkeys';
import {
  OVERRIDE_PRESET_POSITIONS,
  overridePercentForPosition,
} from '@/lib/overridePresetHotkeys';
import {
  setKioskModePreference,
  setLinuxCncAutostartPreference,
  setOverridePresetHotkeyPreference,
  setReloadToolOnStartupPreference,
  setShowVirtualSidebarPreference,
  setVirtualSidebarHotkeyPreference,
} from '@/lib/uiPreferences';
import {
  getVirtualSidebarButtonLabel,
  VIRTUAL_SIDEBAR_BUTTON_ORDER,
} from '@/lib/virtualSidebarButtons';
import type { VirtualSidebarButtonId } from '@/lib/virtualSidebarHotkeys';
import { useAppStore } from '@/store';
import { setAppLocale } from '@/i18n/config';
import { isSupportedLocale, type SupportedLocale } from '@/i18n/constants';
import { HAL_TOOL_IDS, launchHalTool, type HalToolId } from '@/lib/halToolsApi';
import { halToolLaunchErrorMessage } from '@/lib/halToolErrors';
import { fetchNetworkInfo, type NetworkInfo } from '@/lib/networkInfoApi';

type CapturingHotkeyTarget =
  | { scope: 'virtualSidebar'; buttonId: VirtualSidebarButtonId }
  | { scope: OverridePresetKind; position: (typeof OVERRIDE_PRESET_POSITIONS)[number] };

function SettingsRow({
  label,
  children,
  testId,
}: {
  label: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-2 py-2 sm:flex-row sm:items-center sm:justify-between" data-e2e={testId}>
      <span className="text-sm text-foreground shrink-0">{label}</span>
      <div className="min-w-0 sm:text-right">{children}</div>
    </div>
  );
}

function SettingsGroup({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium text-muted-foreground">{title}</h4>
      <div className="space-y-0 border-l border-border/40 pl-4">{children}</div>
    </div>
  );
}

export function SettingsScreen() {
  const { t, i18n } = useTranslation(['settings', 'common']);
  const showVirtualSidebar = useAppStore((state) => state.showVirtualSidebar);
  const kioskMode = useAppStore((state) => state.kioskMode);
  const runLinuxCncAtStartup = useAppStore((state) => state.runLinuxCncAtStartup);
  const linuxCncIniPath = useAppStore((state) => state.linuxCncIniPath);
  const reloadToolOnStartup = useAppStore((state) => state.reloadToolOnStartup);
  const userPreferencesLoadFailed = useAppStore((state) => state.userPreferencesLoadFailed);
  const showErrorToast = useAppStore((state) => state.showErrorToast);
  const [kioskSaving, setKioskSaving] = useState(false);
  const [autostartSaving, setAutostartSaving] = useState(false);
  const [reloadToolSaving, setReloadToolSaving] = useState(false);
  const debugLoggingEnabled = useAppStore((state) => state.debugLoggingEnabled);
  const setDebugLoggingEnabled = useAppStore((state) => state.setDebugLoggingEnabled);
  const debugLogEventBus = useAppStore((state) => state.debugLogEventBus);
  const setDebugLogEventBus = useAppStore((state) => state.setDebugLogEventBus);
  const debugLogWsOutgoing = useAppStore((state) => state.debugLogWsOutgoing);
  const setDebugLogWsOutgoing = useAppStore((state) => state.setDebugLogWsOutgoing);
  const debugLogWsIncoming = useAppStore((state) => state.debugLogWsIncoming);
  const setDebugLogWsIncoming = useAppStore((state) => state.setDebugLogWsIncoming);
  const errorToasts = useAppStore((state) => state.errorToasts);
  const clearErrorToasts = useAppStore((state) => state.clearErrorToasts);
  const commandResultHistory = useAppStore((state) => state.commandResultHistory);
  const mdiCommandHistory = useAppStore((state) => state.mdiCommandHistory);
  const programEditor = useAppStore((state) => state.programEditor);
  const resetProgramEditor = useAppStore((state) => state.resetProgramEditor);
  const backendWebSocketUrl = useAppStore((state) => state.backendWebSocketUrl);
  const virtualSidebarHotkeys = useAppStore((state) => state.virtualSidebarHotkeys);
  const feedOverrideHotkeys = useAppStore((state) => state.feedOverrideHotkeys);
  const spindleOverrideHotkeys = useAppStore((state) => state.spindleOverrideHotkeys);
  const [capturingHotkeyTarget, setCapturingHotkeyTarget] =
    useState<CapturingHotkeyTarget | null>(null);
  const [launchingHalTool, setLaunchingHalTool] = useState<HalToolId | null>(null);
  // Asked once per mount: the bind host and the machine's addresses do not change while the
  // backend runs, and the answer is only ever read off the screen.
  const [networkInfo, setNetworkInfo] = useState<NetworkInfo | null>(null);
  const [networkInfoLoaded, setNetworkInfoLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchNetworkInfo().then((info) => {
      if (cancelled) return;
      setNetworkInfo(info);
      setNetworkInfoLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const languageOptions = useMemo(
    () => [
      { value: 'en', label: t('common:language.en') },
      { value: 'de', label: t('common:language.de') },
    ],
    [t],
  );

  const windowModeOptions = useMemo(
    () => [
      { value: 'kiosk', label: t('settings:display.windowModeKiosk') },
      { value: 'windowed', label: t('settings:display.windowModeWindowed') },
    ],
    [t],
  );

  const highlightPart =
    programEditor.currentLineIndex != null
      ? t('settings:programEditor.highlightLine', { line: programEditor.currentLineIndex + 1 })
      : '';
  const programEditorSummary =
    programEditor.content.length > 0 || programEditor.filePath
      ? t('settings:programEditor.summaryWithContent', {
          count: programEditor.content.length,
          pathSegment:
            programEditor.filePath != null && programEditor.filePath.length > 0
              ? t('settings:programEditor.pathSeparator', { path: programEditor.filePath })
              : '',
          highlight: highlightPart,
          startLine: programEditor.pendingAutoRunStartLine,
        })
      : t('settings:programEditor.summaryEmpty', {
          highlight: highlightPart,
          startLine: programEditor.pendingAutoRunStartLine,
        });

  const lng: SupportedLocale = isSupportedLocale(i18n.language) ? i18n.language : 'en';

  const virtualSidebarButtonLabel = (buttonId: VirtualSidebarButtonId) =>
    getVirtualSidebarButtonLabel(buttonId, t, 'components:virtualSidebar.');

  const overridePresetLabel = (
    kind: OverridePresetKind,
    position: (typeof OVERRIDE_PRESET_POSITIONS)[number],
  ) => {
    const kindLabel = t(`settings:overridePresetHotkeys.kinds.${kind}`);
    if (kind === 'feed' && position === 0) {
      return t('settings:overridePresetHotkeys.positionLabelFeedZero', {
        kind: kindLabel,
        position,
      });
    }
    return t('settings:overridePresetHotkeys.positionLabel', {
      kind: kindLabel,
      position,
      percent: overridePercentForPosition(position),
    });
  };

  const conflictLabel = (conflict: HotkeyConflict): string => {
    if (conflict.scope === 'virtualSidebar') {
      return virtualSidebarButtonLabel(conflict.buttonId);
    }
    return overridePresetLabel(conflict.scope, conflict.position);
  };

  const showHotkeyDuplicateToast = (conflict: HotkeyConflict) => {
    showErrorToast({
      message: t('settings:hotkeys.duplicate', {
        target: conflictLabel(conflict),
      }),
      tone: 'info',
    });
  };

  const handleLaunchHalTool = (tool: HalToolId) => {
    if (launchingHalTool != null) return;
    setLaunchingHalTool(tool);
    void launchHalTool(tool).then((result) => {
      setLaunchingHalTool(null);
      if (!result.ok) {
        showErrorToast({
          message: halToolLaunchErrorMessage(t, tool, result.code, result.message),
        });
      }
    });
  };

  return (
    <div className="h-full w-full flex flex-col">
      <Card className="h-full w-full flex flex-col gap-6 px-6 py-6 min-h-0">
        <CardHeader className="pb-0">
          <CardTitle>{t('settings:title')}</CardTitle>
          <CardDescription>{t('settings:description')}</CardDescription>
        </CardHeader>

        <CardContent className="flex min-h-0 flex-1 flex-col gap-8 overflow-y-auto pt-0 pl-4 pr-1 scrollbar-left-custom lg:max-w-4xl">
          <SettingsGroup title={t('settings:groups.connection')}>
            <SettingsRow label={t('settings:connection.wsUrl')} testId="settings-row-ws-url">
              <span className="text-xs font-mono text-muted-foreground max-w-[min(520px,55vw)] truncate text-right block">
                {backendWebSocketUrl ?? t('settings:connection.notLoaded')}
              </span>
            </SettingsRow>
            <SettingsRow
              label={t('settings:connection.interfaceAddress')}
              testId="settings-row-interface-address"
            >
              <span className="max-w-[min(520px,55vw)] text-right block">
                <span className="text-xs font-mono text-muted-foreground block">
                  {!networkInfoLoaded
                    ? t('settings:connection.notLoaded')
                    : networkInfo === null
                      ? t('settings:connection.addressUnavailable')
                      : networkInfo.urls.length > 0
                        ? networkInfo.urls.join(' · ')
                        : `http://${networkInfo.host}:${networkInfo.port}`}
                </span>
                {networkInfo !== null &&
                  networkInfo.urls.length > 0 &&
                  !networkInfo.reachableFromNetwork && (
                    <span className="text-[11px] text-muted-foreground/80 block">
                      {t('settings:connection.notServedOnNetwork', { host: networkInfo.host })}
                    </span>
                  )}
              </span>
            </SettingsRow>
            <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
              {t('settings:connection.help', {
                configFile: PLASMAWEB_CONFIG_JSON,
                public: 'public/',
                docLink: 'docs/frontend-web-start.md',
              })}
            </p>
          </SettingsGroup>

          <SettingsGroup title={t('settings:groups.display')}>
            <SettingsRow
              label={t('settings:display.virtualSidebar')}
              testId="settings-row-virtual-sidebar"
            >
              <ToggleSwitch
                checked={showVirtualSidebar}
                onCheckedChange={() => setShowVirtualSidebarPreference(!showVirtualSidebar)}
                size="sm"
              />
            </SettingsRow>
            <SettingsRow
              label={t('settings:display.windowMode')}
              testId="settings-row-window-mode"
            >
              <div className="min-w-[10rem] max-w-[min(280px,50vw)]">
                <TouchSelectField
                  hideLabel
                  label={t('settings:display.windowMode')}
                  value={kioskMode ? 'kiosk' : 'windowed'}
                  disabled={kioskSaving}
                  onChange={(v) => {
                    const nextKiosk = v === 'kiosk';
                    if (nextKiosk === kioskMode) return;
                    setKioskSaving(true);
                    void setKioskModePreference(nextKiosk).then((ok) => {
                      setKioskSaving(false);
                      if (!ok) {
                        showErrorToast({ message: t('settings:display.windowModeSaveFailed') });
                      }
                    });
                  }}
                  options={windowModeOptions}
                  dialogTitle={t('settings:display.windowMode')}
                  triggerClassName="h-9 min-h-9 py-0 text-sm"
                />
              </div>
            </SettingsRow>
            <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
              {t('settings:display.windowModeHelp')}
            </p>
            <SettingsRow label={t('settings:display.language')} testId="settings-row-language">
              <div className="min-w-[10rem] max-w-[min(280px,50vw)]">
                <TouchSelectField
                  hideLabel
                  label={t('settings:display.language')}
                  value={lng}
                  onChange={(v) => {
                    if (isSupportedLocale(v)) setAppLocale(v);
                  }}
                  options={languageOptions}
                  dialogTitle={t('settings:display.language')}
                  triggerClassName="h-9 min-h-9 py-0 text-sm"
                />
              </div>
            </SettingsRow>
            <SettingsRow
              label={t('settings:display.linuxCncAutostart')}
              testId="settings-row-linuxcnc-autostart"
            >
              <ToggleSwitch
                checked={runLinuxCncAtStartup}
                disabled={autostartSaving}
                onCheckedChange={() => {
                  const next = !runLinuxCncAtStartup;
                  setAutostartSaving(true);
                  void setLinuxCncAutostartPreference(next).then((result) => {
                    setAutostartSaving(false);
                    if (!result.ok) {
                      const code = result.code ?? 'save_failed';
                      const messageKey = `settings:display.linuxCncAutostartErrors.${code}`;
                      const fallback = t('settings:display.linuxCncAutostartSaveFailed');
                      showErrorToast({
                        message: i18n.exists(messageKey) ? t(messageKey) : fallback,
                      });
                    }
                  });
                }}
                size="sm"
              />
            </SettingsRow>
            <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
              {t('settings:display.linuxCncAutostartHelp')}
            </p>
            {runLinuxCncAtStartup && linuxCncIniPath ? (
              <p
                className="text-[11px] text-muted-foreground/80 pl-1 pr-4 font-mono truncate"
                data-e2e="settings-linuxcnc-autostart-ini"
              >
                {t('settings:display.linuxCncAutostartIni', {
                  path: linuxCncIniPath,
                })}
              </p>
            ) : null}
            <SettingsRow
              label={t('settings:display.reloadToolOnStartup')}
              testId="settings-row-reload-tool-on-startup"
            >
              <ToggleSwitch
                checked={reloadToolOnStartup}
                disabled={reloadToolSaving}
                onCheckedChange={() => {
                  const next = !reloadToolOnStartup;
                  setReloadToolSaving(true);
                  void setReloadToolOnStartupPreference(next).then((ok) => {
                    setReloadToolSaving(false);
                    if (!ok) {
                      showErrorToast({
                        message: t('settings:display.reloadToolOnStartupSaveFailed'),
                      });
                    }
                  });
                }}
                size="sm"
              />
            </SettingsRow>
            <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
              {t('settings:display.reloadToolOnStartupHelp')}
            </p>
            {userPreferencesLoadFailed ? (
              <p
                className="text-[11px] text-amber-600/90 dark:text-amber-400/90 pl-1 pr-4"
                data-e2e="settings-user-preferences-load-failed"
              >
                {t('settings:display.userPreferencesLoadFailed')}
              </p>
            ) : null}
          </SettingsGroup>

          <SettingsGroup title={t('settings:groups.halTools')}>
            <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
              {t('settings:halTools.help')}
            </p>
            <div className="flex flex-wrap gap-2 pl-1 pt-1">
              {HAL_TOOL_IDS.map((toolId) => (
                <button
                  key={toolId}
                  type="button"
                  data-e2e={`settings-hal-tool-${toolId}`}
                  className="inline-flex items-center justify-center h-9 px-3 rounded-md border border-border/60 bg-background/60 text-sm text-foreground hover:bg-muted/70 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                  disabled={launchingHalTool != null}
                  onClick={() => handleLaunchHalTool(toolId)}
                >
                  {t(`settings:halTools.tools.${toolId}`)}
                </button>
              ))}
            </div>
          </SettingsGroup>

          <SettingsGroup title={t('settings:groups.virtualSidebarHotkeys')}>
            <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
              {t('settings:virtualSidebarHotkeys.help')}
            </p>
            {VIRTUAL_SIDEBAR_BUTTON_ORDER.map((buttonId) => (
              <SettingsRow
                key={buttonId}
                label={virtualSidebarButtonLabel(buttonId)}
                testId={`settings-row-virtual-sidebar-hotkey-${buttonId}`}
              >
                <HotkeyCaptureButton
                  value={virtualSidebarHotkeys[buttonId] ?? null}
                  isCapturing={
                    capturingHotkeyTarget?.scope === 'virtualSidebar' &&
                    capturingHotkeyTarget.buttonId === buttonId
                  }
                  onCapturingChange={(capturing) => {
                    setCapturingHotkeyTarget(
                      capturing ? { scope: 'virtualSidebar', buttonId } : null,
                    );
                  }}
                  onChange={(hotkey) => {
                    const result = setVirtualSidebarHotkeyPreference(buttonId, hotkey);
                    if (!result.ok && result.conflict) {
                      showHotkeyDuplicateToast(result.conflict);
                    }
                  }}
                  data-e2e={`settings-hotkey-button-${buttonId}`}
                />
              </SettingsRow>
            ))}
          </SettingsGroup>

          {(['feed', 'spindle'] as const).map((kind) => {
            const hotkeys = kind === 'feed' ? feedOverrideHotkeys : spindleOverrideHotkeys;
            return (
              <SettingsGroup key={kind} title={t(`settings:groups.${kind}OverrideHotkeys`)}>
                <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
                  {t('settings:overridePresetHotkeys.help')}
                </p>
                <details
                  className="group pl-1 pr-1"
                  data-e2e={`settings-${kind}-override-hotkeys`}
                >
                  <summary className="cursor-pointer select-none list-none text-sm text-foreground py-2 flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <span
                      aria-hidden
                      className="inline-block text-muted-foreground transition-transform group-open:rotate-90"
                    >
                      ▸
                    </span>
                    {t('settings:overridePresetHotkeys.expandPositions')}
                  </summary>
                  <div className="space-y-0 border-l border-border/40 pl-4">
                    {OVERRIDE_PRESET_POSITIONS.map((position) => (
                      <SettingsRow
                        key={`${kind}-${position}`}
                        label={overridePresetLabel(kind, position)}
                        testId={`settings-row-${kind}-override-hotkey-${position}`}
                      >
                        <HotkeyCaptureButton
                          value={hotkeys[position] ?? null}
                          isCapturing={
                            capturingHotkeyTarget?.scope === kind &&
                            capturingHotkeyTarget.position === position
                          }
                          onCapturingChange={(capturing) => {
                            setCapturingHotkeyTarget(
                              capturing ? { scope: kind, position } : null,
                            );
                          }}
                          onChange={(hotkey) => {
                            const result = setOverridePresetHotkeyPreference(
                              kind,
                              position,
                              hotkey,
                            );
                            if (!result.ok && result.conflict) {
                              showHotkeyDuplicateToast(result.conflict);
                            }
                          }}
                          data-e2e={`settings-${kind}-override-hotkey-${position}`}
                        />
                      </SettingsRow>
                    ))}
                  </div>
                </details>
              </SettingsGroup>
            );
          })}

          <SettingsGroup title={t('settings:groups.debugLogging')}>
            <div className="space-y-1">
              <SettingsRow label={t('settings:debugLogging.masterToggle')}>
                <ToggleSwitch
                  checked={debugLoggingEnabled}
                  onCheckedChange={() => setDebugLoggingEnabled(!debugLoggingEnabled)}
                  size="sm"
                />
              </SettingsRow>
              <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
                {t('settings:debugLogging.help')}
              </p>
            </div>

            <div className="space-y-1 pt-3">
              <h5 className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">
                {t('settings:debugLogging.whatIsLogged')}
              </h5>
              <SettingsRow label={t('settings:debugLogging.eventBus')}>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border border-border/60"
                  checked={debugLogEventBus}
                  onChange={(e) => setDebugLogEventBus(e.target.checked)}
                />
              </SettingsRow>
              <SettingsRow label={t('settings:debugLogging.wsOutgoing')}>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border border-border/60"
                  checked={debugLogWsOutgoing}
                  onChange={(e) => setDebugLogWsOutgoing(e.target.checked)}
                />
              </SettingsRow>
              <SettingsRow label={t('settings:debugLogging.wsIncoming')}>
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border border-border/60"
                  checked={debugLogWsIncoming}
                  onChange={(e) => setDebugLogWsIncoming(e.target.checked)}
                />
              </SettingsRow>
            </div>
          </SettingsGroup>

          <SettingsGroup title={t('settings:groups.debugState')}>
            <div className="space-y-2">
              <h5 className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">
                {t('settings:debugState.snapshotTitle')}
              </h5>
              <div className="space-y-1">
                <SettingsRow label={t('settings:debugState.logAll')}>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-8 px-3 rounded-md border border-border/60 bg-background/60 text-[11px] font-mono text-foreground hover:bg-muted/70 transition-colors"
                    onClick={() => {
                      const fullState = useAppStore.getState();
                      console.groupCollapsed('[plasmaweb] state snapshot (settings)');
                      console.log('AppStore state snapshot:', fullState);
                      console.groupEnd();
                    }}
                  >
                    {t('settings:debugState.logButton')}
                  </button>
                </SettingsRow>
                <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
                  {t('settings:debugState.snapshotHelp')}
                </p>
              </div>

              <div className="pt-2 border-t border-border/40" />

              <div className="space-y-1">
                <h5 className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">
                  {t('settings:debugState.programEditor')}
                </h5>
                <SettingsRow label={t('settings:debugState.current')}>
                  <AppTooltip content={programEditorSummary} className="max-w-[min(420px,50vw)] min-w-0">
                    <span className="text-sm text-muted-foreground max-w-[min(420px,50vw)] truncate text-right block">
                      {programEditorSummary}
                    </span>
                  </AppTooltip>
                </SettingsRow>
                <SettingsRow label={t('settings:debugState.resetEditor')}>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-8 px-3 rounded-md border border-border/60 bg-background/60 text-[11px] font-mono text-foreground hover:bg-muted/70 transition-colors"
                    onClick={() => resetProgramEditor()}
                  >
                    {t('settings:debugState.resetButton')}
                  </button>
                </SettingsRow>
                <p className="text-[11px] text-muted-foreground/80 pl-1 pr-4">
                  {t('settings:debugState.resetHelp')}
                </p>
              </div>

              <div className="pt-2 border-t border-border/40" />

              <div className="space-y-1">
                <h5 className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">
                  {t('settings:debugState.mdi')}
                </h5>
                <SettingsRow label={t('settings:debugState.historyCount')}>
                  <span className="text-sm text-muted-foreground">{mdiCommandHistory.length}</span>
                </SettingsRow>
              </div>

              <div className="pt-2 border-t border-border/40" />

              <div className="space-y-1">
                <h5 className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">
                  {t('settings:debugState.wsCommands')}
                </h5>
                <SettingsRow label={t('settings:debugState.commandResultRing')}>
                  <span className="text-sm text-muted-foreground">{commandResultHistory.length}</span>
                </SettingsRow>
              </div>

              <div className="pt-2 border-t border-border/40" />

              <div className="space-y-1">
                <h5 className="text-xs font-medium text-muted-foreground/80 uppercase tracking-wide">
                  {t('settings:debugState.errorToasts')}
                </h5>
                <SettingsRow label={t('settings:debugState.openToasts')}>
                  <span className="text-sm text-muted-foreground">{errorToasts.length}</span>
                </SettingsRow>
                <SettingsRow label={t('settings:debugState.clearToasts')}>
                  <button
                    type="button"
                    className="inline-flex items-center justify-center h-8 px-3 rounded-md border border-border/60 bg-background/60 text-[11px] font-mono text-foreground hover:bg-muted/70 transition-colors disabled:opacity-50 disabled:pointer-events-none"
                    disabled={errorToasts.length === 0}
                    onClick={() => clearErrorToasts()}
                  >
                    {t('settings:debugState.clearToastsButton')}
                  </button>
                </SettingsRow>
              </div>
            </div>
          </SettingsGroup>
        </CardContent>
      </Card>
    </div>
  );
}
