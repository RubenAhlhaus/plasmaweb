import { useTranslation } from 'react-i18next';
import { AppTooltip } from '@/components/AppTooltip';
import { Button } from './ui/button';
import { Home, FileCode, FileText, Wrench, Crosshair, Settings, Flame } from 'lucide-react';
import { useAppStore } from '@/store';

/** Order matches indices in `src/constants/sidebarNav.ts` and screen routing in `App`. */
const sidebarButtons = [
  { icon: Home, labelKey: 'nav.home' as const },
  { icon: FileCode, labelKey: 'nav.macros' as const },
  { icon: FileText, labelKey: 'nav.program' as const },
  { icon: Wrench, labelKey: 'nav.tools' as const },
  { icon: Crosshair, labelKey: 'nav.probing' as const },
  { icon: Settings, labelKey: 'nav.settings' as const },
  // Appended, not inserted: the indices above are referenced from sidebarNav.ts, HAL panel
  // buttons and hotkeys, so plasma has to take the next free slot.
  { icon: Flame, labelKey: 'nav.plasma' as const, requiresPlasma: true },
];

type RightSidebarProps = {
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export function RightSidebar({ selectedIndex, onSelect }: RightSidebarProps) {
  const { t } = useTranslation('common');
  const plasmaAvailable = useAppStore((s) => s.plasmaAvailable);
  return (
    <div className="w-40 flex flex-col h-full min-h-0">
      {sidebarButtons.map(({ icon: Icon, labelKey, requiresPlasma }, idx) => {
        if (requiresPlasma && !plasmaAvailable) {
          return null;
        }
        const label = t(labelKey);
        const isSelected = selectedIndex === idx;
        return (
          <AppTooltip key={idx} content={label} className="flex-1 w-full min-h-0 flex">
            <Button
              variant="surface"
              data-e2e={`sidebar-nav-${labelKey.replace('nav.', '')}`}
              style={
                isSelected
                  ? { background: 'linear-gradient(135deg, hsl(210 100% 45%), hsl(142 76% 36%))' }
                  : undefined
              }
              size="icon"
              className="flex-1 w-full rounded-none h-full"
              onClick={() => onSelect(idx)}
            >
              <Icon className="h-16 w-16" />
            </Button>
          </AppTooltip>
        );
      })}
    </div>
  );
}
