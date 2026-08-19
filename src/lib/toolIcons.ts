import type { Tool, ToolType } from '@/types/tools';

const END_MILL_ICON = '/tools/endmill.png';
const BALLNOSE_ICON = '/tools/ballnose.png';
const FACEMILL_ICON = '/tools/facemill.png';
const BULLNOSE_ICON = '/tools/bullnose.png';
const DOVETAIL_ICON = '/tools/dovetail.png';
const DRILL_ICON = '/tools/drill.png';
const REAMER_ICON = '/tools/reamer.png';
const SLITTING_ICON = '/tools/slittingmill.png';
const COUNTERSUNK_ICON = '/tools/countersunk.png';
const THREADCUTTER_ICON = '/tools/threadcutter.png';
const DEBURR_ICON = '/tools/deburr.png';

function normalizeToolType(type?: string): string | undefined {
  if (!type) return undefined;
  return type.toLowerCase();
}

function getIconByToolType(type?: ToolType | string): string {
  const norm = normalizeToolType(type);

  if (!norm) return END_MILL_ICON;

  // Ball / ball-nose end mill
  if (norm.includes('ball') && norm.includes('mill')) {
    return BALLNOSE_ICON;
  }

  // Face Mill
  if (norm.includes('face') && norm.includes('mill')) {
    return FACEMILL_ICON;
  }

  // Bullnose Mill
  if (norm.includes('bullnose') && norm.includes('mill')) {
    return BULLNOSE_ICON;
  }

  // Dovetail Mill
  if (norm.includes('dovetail') && norm.includes('mill')) {
    return DOVETAIL_ICON;
  }

  // Slitting / Slot Mill
  if (norm.includes('slitting') || norm.includes('slot mill')) {
    return SLITTING_ICON;
  }

  // Chamfer / deburring — generic deburr icon
  if (norm.includes('chamfer')) {
    return DEBURR_ICON;
  }

  // Drill-like tools
  if (
    norm === 'drill' ||
    norm === 'center drill' ||
    norm === 'spot drill' ||
    norm === 'boring bar'
  ) {
    return DRILL_ICON;
  }

  // Reamer
  if (norm === 'reamer') {
    return REAMER_ICON;
  }

  // Countersink
  if (norm === 'counter sink' || norm === 'countersink') {
    return COUNTERSUNK_ICON;
  }

  // Threading tools
  if (
    norm === 'thread mill' ||
    norm === 'tap left hand' ||
    norm === 'tap right hand'
  ) {
    return THREADCUTTER_ICON;
  }

  return END_MILL_ICON;
}

export function getToolIconSrc(tool?: Tool | null): string {
  if (!tool) return END_MILL_ICON;
  return getIconByToolType(tool.type);
}

