import type { LinuxCncMotionStatus, LinuxCncStatusRoot } from '@/store/types';

const COORDINATE_SYSTEM_IDS = [
  '0',
  'G54',
  'G55',
  'G56',
  'G57',
  'G58',
  'G59',
  'G59.1',
  'G59.2',
  'G59.3',
] as const;

type CoordinateSystemId = (typeof COORDINATE_SYSTEM_IDS)[number];

export type CoordinateAxisKey = 'x' | 'y' | 'z' | 'a' | 'b' | 'c' | 'u' | 'v' | 'w';

interface CoordinateSystemInfo {
  id: CoordinateSystemId;
  label: string;
  isActive: boolean;
  offsets: Partial<Record<CoordinateAxisKey, number>>;
}

function mapG5xIndexToId(g5xIndex: number | undefined): CoordinateSystemId {
  switch (g5xIndex) {
    case 1:
      return 'G54';
    case 2:
      return 'G55';
    case 3:
      return 'G56';
    case 4:
      return 'G57';
    case 5:
      return 'G58';
    case 6:
      return 'G59';
    case 7:
      return 'G59.1';
    case 8:
      return 'G59.2';
    case 9:
      return 'G59.3';
    case 0:
    default:
      return '0';
  }
}

export function mapStatusToCoordinateSystems(status: LinuxCncStatusRoot): CoordinateSystemInfo[] {
  // Prefer backend-prepared list (backend/coordinate_systems.list_coordinate_systems)
  const fromBackend = status.coordinate_systems;

  if (Array.isArray(fromBackend) && fromBackend.length > 0) {
    return fromBackend
      .map((entry) => {
        const id = entry.id as CoordinateSystemId | undefined;
        if (!id || !COORDINATE_SYSTEM_IDS.includes(id)) {
          return null;
        }
        const rawOffsets = entry.offsets ?? {};
        const offsets: CoordinateSystemInfo['offsets'] = {};
        (Object.keys(rawOffsets) as CoordinateAxisKey[]).forEach((axis) => {
          const val = rawOffsets[axis];
          if (typeof val === 'number') {
            offsets[axis] = val;
          }
        });
        return {
          id,
          label: entry.label ?? id,
          isActive: Boolean(entry.is_active),
          offsets,
        } as CoordinateSystemInfo;
      })
      .filter((x): x is CoordinateSystemInfo => x !== null);
  }

  // Fallback: derive active G5x/G92 only from motion status
  const motion: LinuxCncMotionStatus = status.motion ?? {};
  const g5xIndex = motion.g5x_index;
  const g5xOffset = motion.g5x_offset ?? [];
  const g92Offset = motion.g92_offset ?? [];

  const activeId = mapG5xIndexToId(g5xIndex);

  return COORDINATE_SYSTEM_IDS.map((id) => {
    const isActive = id === activeId;

    const offsets: CoordinateSystemInfo['offsets'] = {};

    if (isActive) {
      const axes: Array<[CoordinateAxisKey, number]> = [
        ['x', 0],
        ['y', 1],
        ['z', 2],
      ];

      for (const [axis, index] of axes) {
        const g5 = typeof g5xOffset[index] === 'number' ? g5xOffset[index] : 0;
        const g92 = typeof g92Offset[index] === 'number' ? g92Offset[index] : 0;
        const value = g5 + g92;
        if (value !== 0) {
          offsets[axis] = value;
        }
      }
    }

    return {
      id,
      label: id,
      isActive,
      offsets,
    };
  });
}

