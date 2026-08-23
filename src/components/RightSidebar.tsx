import { useTranslation } from 'react-i18next';
import { AppTooltip } from '@/components/AppTooltip';
import { PlasmaTorchIcon } from '@/components/icons/PlasmaTorchIcon';
import { Button } from './ui/button';
import { Home, FileCode, FileText, Wrench, Crosshair, Settings } from 'lucide-react';
import { usePlasmaScreenFormat } from '@/hooks/usePlasmaScreenFormat';
import type { PlasmaScreenFormat } from '@/lib/plasmaScreenFormat';
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
  { icon: PlasmaTorchIcon, labelKey: 'nav.plasma' as const, requiresPlasma: true },
];

/**
 * The sidebar's share of the screen, per format.
 *
 * A 4:3 panel is the tight one: 160 px of navigation out of 1002 leaves the plasma screen
 * fighting for width, and the icons are legible well below that. The tall format gets the
 * narrowest of all — a 750 px screen has none to spare.
 */
const SIDEBAR_WIDTH: Record<PlasmaScreenFormat, string> = {
  wide: 'w-40',
  standard: 'w-24',
  tall: 'w-20',
};

/**
 * Icon size per format, in pixels.
 *
 * Passed to the icon rather than set with a utility class: these are 24-unit SVGs, and scaling
 * one to 64 px by CSS leaves a stroke drawn for 24 px looking heavy and soft. Sizing the SVG
 * and thinning its stroke to match keeps the geometry crisp at any size.
 */
const ICON_SIZE: Record<PlasmaScreenFormat, number> = {
  wide: 48,
  standard: 32,
  tall: 28,
};

/** Stroke that reads the same at each size: lucide draws for 24 px at width 2. */
function strokeFor(size: number): number {
  return Math.max(1, Math.round((2 * (24 / size)) * 100) / 100);
}

type RightSidebarProps = {
  selectedIndex: number;
  onSelect: (index: number) => void;
};

export function RightSidebar({ selectedIndex, onSelect }: RightSidebarProps) {
  const { t } = useTranslation('common');
  const plasmaAvailable = useAppStore((s) => s.plasmaAvailable);
  const format = usePlasmaScreenFormat();
  const iconSize = ICON_SIZE[format];

  return (
    <div
      className={`${SIDEBAR_WIDTH[format]} flex flex-col h-full min-h-0`}
      data-e2e="sidebar-nav"
      data-format={format}
    >
      {sidebarButtons.map(({ icon: Icon, labelKey, requiresPlasma }, idx) => {
        if (requiresPlasma && !plasmaAvailable) {
          return null;
        }
        const label = t(labelKey);
        const isSelected = selectedIndex === idx;
        return (
          <AppTooltip key={idx} content={label} className="flex-1 w-full min-h-0 flex">
            <Button
              // The selected tab is the theme's highlight with the readable colour on it, and
              // that has to come from the *variant*: `surface` sets its background through a
              // plain `.surface` class, which beats a `bg-primary` utility on source order —
              // the icon would go dark while the background stayed grey.
              variant={isSelected ? 'default' : 'surface'}
              data-e2e={`sidebar-nav-${labelKey.replace('nav.', '')}`}
              data-active={isSelected}
              size="icon"
              className={`flex-1 w-full rounded-none h-full ${
                isSelected ? 'hover:bg-primary' : 'text-foreground'
              }`}
              onClick={() => onSelect(idx)}
            >
              <Icon width={iconSize} height={iconSize} strokeWidth={strokeFor(iconSize)} />
            </Button>
          </AppTooltip>
        );
      })}
    </div>
  );
}
