import { useTranslation } from 'react-i18next';
import { CoordinatesDisplay } from '@/components/CoordinatesDisplay';
import { MachineVisualization } from '@/components/MachineVisualization';
import { ProgramCodesDisplay } from '@/components/ProgramCodesDisplay';
import { SliderControl } from '@/components/SliderControl';
import { ToolInfoDisplay } from '@/components/ToolInfoDisplay';
import { eventBus } from '@/eventBus';
import { machineVisualizationStackedClassName } from '@/lib/machineScreenLayoutClasses';
import { cn } from '@/lib/utils';
import type { Tool } from '@/types/tools';

type MachinePreviewColumnProps = {
  activeTool: Tool | undefined;
  spindleSpeed: number;
  spindleOverridePercent: number;
  feedRate: number;
  feedOverridePercent: number;
  showProgramCodes?: boolean;
  className?: string;
};

export function MachinePreviewColumn({
  activeTool,
  spindleSpeed,
  spindleOverridePercent,
  feedRate,
  feedOverridePercent,
  showProgramCodes = false,
  className,
}: MachinePreviewColumnProps) {
  const { t } = useTranslation('components');

  return (
    <div
      className={cn(
        'flex h-full min-h-0 min-w-0 flex-col gap-3 overflow-hidden',
        className,
      )}
    >
      <div className="flex min-w-0 shrink-0 flex-wrap items-start gap-4">
        <CoordinatesDisplay
          onClick={() =>
            eventBus.publish('ui.coordinates.openDialog', {
              source: 'coordinatesDisplay',
            })
          }
        />
        {showProgramCodes ? <ProgramCodesDisplay /> : null}
      </div>

      <div className={machineVisualizationStackedClassName}>
        <MachineVisualization />
      </div>

      <div className="flex shrink-0 flex-wrap items-end gap-3">
        <ToolInfoDisplay tool={activeTool} />
        <div className="flex shrink-0 items-end gap-3">
          <div className="w-[200px] shrink-0">
            <SliderControl
              value={spindleSpeed}
              integerDisplay
              percentage={spindleOverridePercent}
              label={t('spindleFeed.spindleTitle')}
              unit="1/min"
              onClick={() =>
                eventBus.publish('ui.spindle.openDialog', { source: 'sliderControl' })
              }
            />
          </div>
          <div className="w-[200px] shrink-0">
            <SliderControl
              value={feedRate}
              integerDisplay
              percentage={feedOverridePercent}
              label={t('spindleFeed.feedTitle')}
              unit="mm/min"
              onClick={() => eventBus.publish('ui.feed.openDialog', { source: 'sliderControl' })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
