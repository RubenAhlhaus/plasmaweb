import { useTranslation } from 'react-i18next';

import { ToolpathCanvas } from '@/components/plasma/ToolpathCanvas';
import { useAppStore } from '@/store';
import { Card } from './ui/card';

/**
 * The machine view: the loaded program's toolpath once there is one to draw.
 *
 * The placeholder below is what a machine without a preview still shows — no plasma layer,
 * or nothing loaded yet. The toolpath comes from the store, so this needs no fetching of its
 * own: whoever asked for the preview already filled it in.
 */
export function MachineVisualization() {
  const { t } = useTranslation('components');
  const toolpath = useAppStore((s) => s.plasmaToolpath);
  const coordinates = useAppStore((s) => s.coordinates);
  const motionLine = useAppStore((s) => s.linuxCncStatus.program.motion_line);

  if (toolpath) {
    return (
      <Card className="h-full w-full overflow-hidden surface-subtle" data-e2e="machine-toolpath">
        <ToolpathCanvas
          toolpath={toolpath}
          torch={{ x: coordinates.x, y: coordinates.y }}
          activeLine={typeof motionLine === 'number' ? motionLine : null}
        />
      </Card>
    );
  }

  return (
    <Card className="w-full h-full flex items-center justify-center surface-subtle">
      <div className="flex h-full w-full min-h-0 flex-col items-center justify-center gap-3 px-4 text-center text-foreground/30">
        <svg
          width="100%"
          height="100%"
          viewBox="0 0 400 300"
          className="min-h-0 max-h-[calc(100%-2.5rem)] opacity-40"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          preserveAspectRatio="xMidYMid meet"
          aria-hidden
        >
          {/* CNC machine base/table */}
          <rect x="50" y="180" width="300" height="80" rx="4" className="stroke-foreground/30" />

          {/* Workpiece */}
          <rect x="120" y="200" width="160" height="50" rx="2" className="stroke-foreground/40 fill-foreground/5" />

          {/* Spindle housing */}
          <rect x="180" y="50" width="40" height="130" rx="2" className="stroke-foreground/30" />

          {/* Spindle/tool */}
          <circle cx="200" cy="200" r="6" className="stroke-foreground/50 fill-foreground/10" />
          <line x1="200" y1="200" x2="200" y2="180" strokeWidth="3" className="stroke-foreground/40" />

          {/* Tool bit */}
          <line x1="200" y1="200" x2="200" y2="220" strokeWidth="2" className="stroke-foreground/50" />
          <line x1="195" y1="220" x2="205" y2="220" strokeWidth="2" className="stroke-foreground/50" />
        </svg>
        <p className="shrink-0 text-base font-medium text-foreground/50">{t('machineVisualization.comingSoon')}</p>
      </div>
    </Card>
  );
}
