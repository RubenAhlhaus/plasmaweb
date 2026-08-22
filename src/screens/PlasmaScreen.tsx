import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { MachineLogPanel } from '@/components/plasma/MachineLogPanel';
import { PlasmaConversationalScreen } from '@/screens/PlasmaConversationalScreen';
import { PlasmaMainScreen } from '@/screens/PlasmaMainScreen';
import { PlasmaMaterialScreen } from '@/screens/PlasmaMaterialScreen';
import { PlasmaParametersScreen } from '@/screens/PlasmaParametersScreen';
import { PlasmaPreviewScreen } from '@/screens/PlasmaPreviewScreen';

const TABS = ['main', 'preview', 'conversational', 'material', 'parameters', 'log'] as const;
type PlasmaTab = (typeof TABS)[number];

/**
 * The plasma screens, as tabs rather than sidebar entries.
 *
 * QtPlasmaC groups MAIN, PREVIEW, CONVERSATIONAL, MATERIAL and PARAMETERS as tabs of one screen (its
 * machine log lives under STATISTICS; here it is a tab of its own), and the sidebar's
 * indices are referenced from `sidebarNav.ts`, HAL panel buttons and hotkeys — so plasma
 * keeps its single slot and does its own tabbing.
 */
export function PlasmaScreen() {
  const { t } = useTranslation('plasma');
  const [tab, setTab] = useState<PlasmaTab>('main');

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-e2e="plasma-screen">
      <div role="tablist" aria-label={t('tabs.label')} className="flex gap-1" data-e2e="plasma-tabs">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            data-e2e={`plasma-tab-${name}`}
            className={`rounded-md px-4 py-2 text-sm font-semibold uppercase tracking-wide transition-colors ${
              tab === name
                ? 'bg-slate-800/90 text-foreground'
                : 'text-muted-foreground hover:bg-slate-900/60'
            }`}
            onClick={() => setTab(name)}
          >
            {t(`tabs.${name}`)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1">
        {tab === 'main' && <PlasmaMainScreen />}
        {tab === 'preview' && <PlasmaPreviewScreen />}
        {tab === 'conversational' && <PlasmaConversationalScreen />}
        {tab === 'material' && <PlasmaMaterialScreen />}
        {tab === 'parameters' && <PlasmaParametersScreen />}
        {tab === 'log' && <MachineLogPanel />}
      </div>
    </div>
  );
}
