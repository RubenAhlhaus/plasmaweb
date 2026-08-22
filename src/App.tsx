import { lazy, Suspense, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from './store';
import { useLcncguiConfigLoader } from './hooks/useLcncguiConfigLoader';
import { useBackendWebSocket } from './hooks/useBackendWebSocket';
import { HeaderBar } from './components/HeaderBar';
import { RightSidebar } from './components/RightSidebar';
import { HomeScreen } from './screens/HomeScreen';
import { PlaceholderScreen } from './screens/PlaceholderScreen';
import { ProgramScreen } from './screens/ProgramScreen';
import { PlasmaScreen } from './screens/PlasmaScreen';
import { ToolsScreen } from './screens/ToolsScreen';
import { VirtualButtonSidebar } from './components/VirtualButtonSidebar';
import { useJogEventSubscription } from './hooks/useJogCommand';
import { useJogWheelScaleSync } from './hooks/useJogWheelScaleSync';
import { useMachineEventBridge } from './hooks/useMachineEventBridge';
import { useProgramExecutionEventBridge } from './hooks/useProgramExecutionEventBridge';
import { usePlasmaToolpath } from './hooks/usePlasmaToolpath';
import { useReloadToolOnStartup } from './hooks/useReloadToolOnStartup';
import { useGlobalHotkeyListener } from './hooks/useGlobalHotkeyListener';
import { usePlasmaKeyboardShortcuts } from './hooks/usePlasmaKeyboardShortcuts';
import { useLiveProgramLineHighlight } from './hooks/useLiveProgramLineHighlight';
import { HomingDialog } from './components/HomingDialog';
import { UnhomedAxisJogDialog } from './components/UnhomedAxisJogDialog';
import { HomingEventListener } from './components/HomingEventListener';
import { ErrorToast } from './components/ErrorToast';
import { CoordinatesDialogHost } from './components/CoordinatesDialogHost';
import { SpindleFeedDialogsHost } from './components/SpindleFeedDialogsHost';
import { ToolChangeDialogHost } from './components/ToolChangeDialogHost';
import {
  SIDEBAR_INDEX_HOME,
  SIDEBAR_INDEX_PLASMA,
  SIDEBAR_INDEX_MACROS,
  SIDEBAR_INDEX_PROGRAM,
  SIDEBAR_INDEX_PROBING,
  SIDEBAR_INDEX_SETTINGS,
  SIDEBAR_INDEX_TOOLS,
} from './constants/sidebarNav';
import { ScreenLoadingFallback } from './components/ScreenLoadingFallback';
import { installLcncguiE2eBridge } from './lib/lcncguiE2eBridge';

const MacrosScreen = lazy(() =>
  import('./screens/MacrosScreen').then((m) => ({ default: m.MacrosScreen })),
);
const SettingsScreen = lazy(() =>
  import('./screens/SettingsScreen').then((m) => ({ default: m.SettingsScreen })),
);

function AppContent() {
  const activeMenuIndex = useAppStore((s) => s.activeMenuIndex);
  const setActiveMenuIndex = useAppStore((s) => s.setActiveMenuIndex);
  const showVirtualSidebar = useAppStore((s) => s.showVirtualSidebar);
  const plasmaAvailable = useAppStore((s) => s.plasmaAvailable);
  const plasmaScreenShownRef = useRef(false);

  useBackendWebSocket();
  useJogEventSubscription();
  useJogWheelScaleSync();
  useMachineEventBridge();
  useProgramExecutionEventBridge();
  useReloadToolOnStartup();
  // App-level, not screen-level: the machine view on the home screen draws the same preview,
  // so the program has to be parsed whether or not the plasma screen has been opened.
  usePlasmaToolpath();
  useGlobalHotkeyListener();
  // QtPlasmaC's own shortcuts, which stay inert until the machine's prefs enable them.
  usePlasmaKeyboardShortcuts();
  useLiveProgramLineHighlight();

  useEffect(() => {
    installLcncguiE2eBridge();
  }, []);

  // On a plasma machine the MAIN screen is the landing screen, the same way QtPlasmaC opens
  // on its MAIN tab. Only the first snapshot moves the user; later ones must not yank the
  // screen away from wherever they navigated.
  useEffect(() => {
    if (plasmaAvailable && !plasmaScreenShownRef.current) {
      plasmaScreenShownRef.current = true;
      setActiveMenuIndex(SIDEBAR_INDEX_PLASMA);
    }
  }, [plasmaAvailable, setActiveMenuIndex]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-gradient-to-br from-background via-slate-900/95 to-background">
      <div className="flex h-full min-h-0 w-full">
        {showVirtualSidebar && (
          <div className="relative z-10 flex h-full w-[100px] flex-shrink-0 items-stretch">
            <VirtualButtonSidebar />
          </div>
        )}
        <div
          className="grid h-full min-h-0 min-w-0 flex-1"
          style={{
            gridTemplateColumns: '1fr 2rem 10rem',
            gridTemplateRows: 'auto 1fr',
          }}
        >
          {/* Status bar: full width up to the sidebar (columns 1+2) */}
          <div className="col-span-2">
            <HeaderBar />
          </div>

          {/* Sidebar: full height, flush with the status bar */}
          <div className="row-span-2 min-h-0">
            <RightSidebar selectedIndex={activeMenuIndex} onSelect={setActiveMenuIndex} />
          </div>

          {/* Content: column 1 only; column 2 is gutter before the sidebar */}
          <div className="relative h-full min-h-0 min-w-0 overflow-x-hidden overflow-y-auto p-6">
            {activeMenuIndex === SIDEBAR_INDEX_HOME && <HomeScreen />}
            {activeMenuIndex === SIDEBAR_INDEX_MACROS && (
              <Suspense fallback={<ScreenLoadingFallback />}>
                <MacrosScreen />
              </Suspense>
            )}
            {activeMenuIndex === SIDEBAR_INDEX_PROGRAM && <ProgramScreen />}
            {activeMenuIndex === SIDEBAR_INDEX_TOOLS && <ToolsScreen />}
            {activeMenuIndex === SIDEBAR_INDEX_PROBING && <PlaceholderScreen titleKey="nav.probing" />}
            {activeMenuIndex === SIDEBAR_INDEX_PLASMA && <PlasmaScreen />}
            {activeMenuIndex === SIDEBAR_INDEX_SETTINGS && (
              <Suspense fallback={<ScreenLoadingFallback />}>
                <SettingsScreen />
              </Suspense>
            )}
          </div>
        </div>
      </div>

      {/* Globale Dialoge (nutzen Portals, beeinflussen Layout nicht) */}
      <HomingDialog />
      <UnhomedAxisJogDialog />
      <HomingEventListener />
      <CoordinatesDialogHost />
      <SpindleFeedDialogsHost />
      <ErrorToast />
      <ToolChangeDialogHost />
    </div>
  );
}

function App() {
  const { t } = useTranslation('common');
  const { state, errorMessage } = useLcncguiConfigLoader();

  if (state === 'loading') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-gradient-to-br from-background via-slate-900/95 to-background text-muted-foreground text-sm">
        {t('configLoader.loading')}
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center gap-4 bg-gradient-to-br from-background via-slate-900/95 to-background text-foreground px-8 text-center max-w-lg">
        <p className="font-medium">{t('configLoader.errorTitle')}</p>
        <p className="text-sm text-muted-foreground">{errorMessage}</p>
        <p className="text-xs text-muted-foreground leading-relaxed">{t('configLoader.errorHelp')}</p>
      </div>
    );
  }

  return <AppContent />;
}

export default App;
