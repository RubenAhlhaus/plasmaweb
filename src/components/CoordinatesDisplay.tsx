import { memo, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store';
import { formatMachineCoordinate } from '@/lib/formatCoordinates';
import { isAxisHomed } from '@/utils/homing';
import { useJointCoordinates } from '@/hooks/useJointCoordinates';
import { Card } from './ui/card';

interface CoordinatesDisplayProps {
  onClick?: () => void;
}

const baseRowClass =
  'flex justify-between items-center py-1.5 border-b border-muted-foreground/50 last:border-b-0';

function getRowClass(isHomed: boolean) {
  return `${baseRowClass}${isHomed ? '' : ' opacity-50'}`;
}

export const CoordinatesDisplay = memo(function CoordinatesDisplay({
  onClick,
}: CoordinatesDisplayProps) {
  const { x, y, z, motionHomed, joints } = useAppStore(
    useShallow((s) => ({
      x: s.coordinates.x,
      y: s.coordinates.y,
      z: s.coordinates.z,
      motionHomed: s.linuxCncStatus.motion.homed,
      joints: s.linuxCncStatus.joints,
    })),
  );
  const jointCoordinates = useJointCoordinates();
  const homingStatus = useMemo(
    () => ({ motion: { homed: motionHomed }, joints }),
    [motionHomed, joints],
  );

  return (
    <Card
      className={`w-[320px] flex flex-col px-9 py-1.5 ${
        onClick ? 'cursor-pointer hover:bg-background/80 transition-colors' : ''
      }`}
      onClick={onClick}
    >
      <div>
        <div className={getRowClass(isAxisHomed(homingStatus, 'x', jointCoordinates))}>
          <span className="text-foreground text-2xl font-semibold">X</span>
          <span
            data-e2e="coord-x"
            className="text-foreground text-3xl font-mono tabular-nums"
          >
            {formatMachineCoordinate(x)}
          </span>
        </div>
        <div className={getRowClass(isAxisHomed(homingStatus, 'y', jointCoordinates))}>
          <span className="text-foreground text-2xl font-semibold">Y</span>
          <span
            data-e2e="coord-y"
            className="text-foreground text-3xl font-mono tabular-nums"
          >
            {formatMachineCoordinate(y)}
          </span>
        </div>
        <div className={getRowClass(isAxisHomed(homingStatus, 'z', jointCoordinates))}>
          <span className="text-foreground text-2xl font-semibold">Z</span>
          <span
            data-e2e="coord-z"
            className="text-foreground text-3xl font-mono tabular-nums"
          >
            {formatMachineCoordinate(z)}
          </span>
        </div>
      </div>
    </Card>
  );
});
