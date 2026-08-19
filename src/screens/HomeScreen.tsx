import { useRef } from 'react';
import { DirectionalControl } from '@/components/DirectionalControl';
import { IncrementSelector } from '@/components/IncrementSelector';
import { MachinePreviewColumn } from '@/components/MachinePreviewColumn';
import { MDIConsole } from '@/components/MDIConsole';
import { useActiveTool } from '@/hooks/useActiveTool';
import { useJogPanelSize } from '@/hooks/useJogPanelSize';
import { useSpindleFeedSlidersFromStatus } from '@/hooks/useSpindleFeedSlidersFromStatus';
import { useToolsFromBackend } from '@/hooks/useToolsFromBackend';
import {
  homeJogControlsRowClassName,
  homeJogPadWrapperClassName,
  homeMdiContainerClassName,
  homeRightColumnClassName,
  machinePreviewColumnStackedClassName,
  machinePreviewGridClassName,
} from '@/lib/machineScreenLayoutClasses';

export function HomeScreen() {
  const jogPanelRef = useRef<HTMLDivElement>(null);
  const jogSize = useJogPanelSize(jogPanelRef);
  const { tools } = useToolsFromBackend();
  const {
    spindleSpeed,
    spindleOverridePercent,
    feedRate,
    feedOverridePercent,
  } = useSpindleFeedSlidersFromStatus();

  const { activeTool } = useActiveTool(tools);

  return (
    <div className={machinePreviewGridClassName}>
      <MachinePreviewColumn
        className={machinePreviewColumnStackedClassName}
        activeTool={activeTool}
        spindleSpeed={spindleSpeed}
        spindleOverridePercent={spindleOverridePercent}
        feedRate={feedRate}
        feedOverridePercent={feedOverridePercent}
        showProgramCodes
      />

      <div
        ref={jogPanelRef}
        className={homeRightColumnClassName}
        data-jog-size={jogSize}
        data-e2e="home-jog-panel"
      >
        <div className={homeJogControlsRowClassName(jogSize)} data-e2e="home-jog-controls">
          <IncrementSelector size={jogSize} />
          <div className={homeJogPadWrapperClassName(jogSize)}>
            <DirectionalControl size={jogSize} />
          </div>
        </div>

        <div className={homeMdiContainerClassName}>
          <MDIConsole />
        </div>
      </div>
    </div>
  );
}
