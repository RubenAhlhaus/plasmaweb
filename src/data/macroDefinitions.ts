import { DEFAULT_PLAN_FACE_STOCK_REMOVAL_MM } from '@/lib/macroGcode/planFaceHeights';
import type { MacroCategoryId, MacroDefinition } from '@/types/macros';

/** Macro id for standard drilling (dialog with tool/preset). */
export const BOHREN_NORMAL_MACRO_ID = 'bohren-normal';
export const BOHRFRAESEN_MACRO_ID = 'bohrfraesen';
export const GEWINDE_SCHNEIDEN_MACRO_ID = 'gewinde-schneiden';

/**
 * Nested block in the program queue: each child is a phase; G-Code expansion runs
 * phase × position (every phase at all pattern holes) — see macroQueueDrag / macroGcode.
 */
export const NESTED_QUEUE_BLOCK_MACRO_ID = 'nested-pattern-block';
export const TASCHE_FRAESEN_MACRO_ID = 'taschenfraesen';
export const KREIS_FRAESEN_MACRO_ID = 'kreisfraesen';
export const KONTUR_FRAESEN_MACRO_ID = 'konturfraesen';
export const NUT_FRAESEN_MACRO_ID = 'nutfraesen';
export const PLAN_FRAESEN_MACRO_ID = 'planfraesen';
export const ENTGRATEN_MACRO_ID = 'entgraten';
export const GRAVIEREN_MACRO_ID = 'gravieren';

export const MACRO_CATEGORIES: readonly MacroCategoryId[] = ['drilling', 'milling'];

const MACRO_DEFINITIONS: MacroDefinition[] = [
  {
    id: NESTED_QUEUE_BLOCK_MACRO_ID,
    category: 'drilling',
    titleKey: 'definitions.nested-pattern-block.title',
    subtitleKey: 'definitions.nested-pattern-block.subtitle',
    defaultParams: {
      name: '',
      patternType: 'custom',
      surfaceZ: 0,
      customPatternPoints: '[{"x":0,"y":0}]',
      // Eckige Anordnung (Gitter)
      startX: 0,
      startY: 0,
      spacingX: 10,
      spacingY: 10,
      columns: 3,
      rows: 3,
      rotationAngle: 0,
      // Runde Anordnung (Lochkreis)
      centerX: 0,
      centerY: 0,
      pitchCircleDiameter: 50,
      startAngle: 0,
      endAngle: 360,
      count: 6,
      stepAngle: 0,
    },
  },
  {
    id: BOHREN_NORMAL_MACRO_ID,
    category: 'drilling',
    titleKey: 'definitions.bohren-normal.title',
    subtitleKey: 'definitions.bohren-normal.subtitle',
    defaultParams: {
      toolId: '',
      presetId: '',
      spindle: '',
      feed: '',
      surfaceZ: 0,
      safeZ: '',
      depth: '',
      einstechtiefeMm: '',
      vorschubHoeheMm: '5',
      x: '',
      y: '',
      coolantOn: false,
      fullRetract: false,
    },
    paramSections: [
      {
        headingKey: 'sections.tool',
        keys: ['toolId', 'presetId', 'spindle', 'feed'],
      },
      {
        headingKey: 'sections.heights',
        keys: ['surfaceZ', 'safeZ', 'vorschubHoeheMm', 'depth', 'einstechtiefeMm'],
      },
      {
        headingKey: 'sections.positions',
        keys: ['x', 'y'],
      },
      {
        headingKey: 'sections.options',
        keys: ['coolantOn', 'fullRetract'],
      },
    ],
  },
  {
    id: BOHRFRAESEN_MACRO_ID,
    category: 'drilling',
    titleKey: 'definitions.bohrfraesen.title',
    subtitleKey: 'definitions.bohrfraesen.subtitle',
    defaultParams: {
      toolId: '',
      presetId: '',
      spindle: '',
      feedXY: '',
      surfaceZ: 0,
      safeZ: '',
      x: '',
      y: '',
      depth: '',
      nominalDiameter: '',
      helixAngle: 3,
      millingDirection: 'climb',
      coolantOn: true,
    },
    paramSections: [
      {
        headingKey: 'sections.tool',
        keys: ['toolId', 'presetId', 'spindle', 'feedXY'],
      },
      {
        headingKey: 'sections.heights',
        keys: ['surfaceZ', 'safeZ', 'depth'],
      },
      {
        headingKey: 'sections.hole',
        keys: ['x', 'y', 'nominalDiameter', 'helixAngle'],
      },
      {
        headingKey: 'sections.options',
        keys: ['millingDirection', 'coolantOn'],
      },
    ],
  },
  /* Commented out until macros are finished — IDs stay exported for G-code / future re-enable.
  {
    id: GEWINDE_SCHNEIDEN_MACRO_ID,
    category: 'Bohren',
    title: 'Gewinde schneiden',
    subtitle: 'Fräsen/Tappen',
    defaultParams: {
      toolId: '',
      presetId: '',
      processType: 'threadMilling',
      x: 0,
      y: 0,
      startZ: 5,
      surfaceZ: 0,
      threadDepth: 12,
      pitch: 1.5,
      threadHand: 'RH',
      threadDiameter: 12,
      coreHoleDiameter: 10.2,
      spindle: 2500,
      feed: 150,
      tappingMode: 'rigid',
      dwellBottom: 0,
      coolantOn: true,
    },
  },
  {
    id: TASCHE_FRAESEN_MACRO_ID,
    category: 'Fräsen',
    title: 'Taschenfräsen',
    subtitle: 'Rechteck/Kreis',
    defaultParams: {
      toolId: '',
      presetId: '',
      pocketType: 'rectangle',
      centerX: 0,
      centerY: 0,
      width: 30,
      height: 20,
      diameter: 25,
      depth: 5,
      stepDown: 1.5,
      stepOver: 3,
      feedXY: 220,
      feedZ: 100,
      spindle: 4500,
      strategy: 'both',
      coolantOn: true,
    },
  },
  {
    id: KREIS_FRAESEN_MACRO_ID,
    category: 'Fräsen',
    title: 'Kreisfräsen',
    subtitle: 'Innen/Außen',
    defaultParams: {
      toolId: '',
      presetId: '',
      centerX: 0,
      centerY: 0,
      diameter: 30,
      depth: 4,
      stepDown: 1,
      feed: 200,
      spindle: 5000,
      millingSide: 'inside',
      direction: 'CCW',
      coolantOn: true,
    },
  },
  {
    id: KONTUR_FRAESEN_MACRO_ID,
    category: 'Fräsen',
    title: 'Konturfräsen',
    subtitle: 'Radius/Kontur einfach',
    defaultParams: {
      toolId: '',
      presetId: '',
      startX: 0,
      startY: 0,
      endX: 40,
      endY: 0,
      radius: 10,
      depth: 3,
      stepDown: 1,
      feed: 220,
      spindle: 4800,
      direction: 'climb',
      coolantOn: true,
    },
  },
  {
    id: NUT_FRAESEN_MACRO_ID,
    category: 'Fräsen',
    title: 'Nutfräsen',
    subtitle: 'Gerade Nut',
    defaultParams: {
      toolId: '',
      presetId: '',
      startX: 0,
      startY: 0,
      endX: 60,
      endY: 0,
      slotWidth: 8,
      depth: 4,
      stepDown: 1,
      sideStep: 1,
      centerCut: true,
      multiplePasses: false,
      feedXY: 220,
      feedZ: 100,
      spindle: 5000,
      coolantOn: true,
    },
  },
  */
  {
    id: PLAN_FRAESEN_MACRO_ID,
    category: 'milling',
    titleKey: 'definitions.planfraesen.title',
    subtitleKey: 'definitions.planfraesen.subtitle',
    defaultParams: {
      toolId: '',
      presetId: '',
      areaStartX: 0,
      areaStartY: 0,
      areaWidth: 80,
      areaHeight: 40,
      cutterOverhangMm: 0,
      vorschubHoeheMm: 5,
      surfaceZ: 0,
      targetZ: -DEFAULT_PLAN_FACE_STOCK_REMOVAL_MM,
      stepOver: 5,
      feedXY: 350,
      feedZ: 120,
      spindle: 3000,
      coolantOn: true,
    },
    paramSections: [
      {
        headingKey: 'sections.tool',
        keys: ['toolId', 'presetId', 'spindle', 'feedXY', 'feedZ'],
      },
      {
        headingKey: 'sections.area',
        keys: [
          'areaStartX',
          'areaStartY',
          'areaWidth',
          'areaHeight',
          'cutterOverhangMm',
          'stepOver',
        ],
      },
      {
        headingKey: 'sections.heights',
        keys: ['vorschubHoeheMm', 'surfaceZ', 'targetZ'],
      },
      {
        headingKey: 'sections.options',
        keys: ['coolantOn'],
      },
    ],
  },
  /*
  {
    id: ENTGRATEN_MACRO_ID,
    category: 'Fräsen',
    title: 'Entgraten',
    subtitle: 'Kante/Bohrung',
    defaultParams: {
      toolId: '',
      presetId: '',
      pathType: 'edge',
      x: 0,
      y: 0,
      zTop: 0,
      chamferWidth: 0.5,
      chamferDepth: 0.2,
      insideOutside: 'outside',
      singleEdgeOnly: false,
      passes: 1,
      feed: 200,
      spindle: 7000,
      coolantOn: false,
    },
  },
  {
    id: GRAVIEREN_MACRO_ID,
    category: 'Fräsen',
    title: 'Gravieren',
    subtitle: 'Text/Kontur',
    defaultParams: {
      toolId: '',
      presetId: '',
      contentType: 'text',
      text: 'TEXT',
      originX: 0,
      originY: 0,
      depth: 0.2,
      fontHeight: 5,
      charSpacing: 1,
      lineSpacing: 1.5,
      rotation: 0,
      alignment: 'left',
      singleLineFont: true,
      mirror: false,
      feed: 120,
      spindle: 10000,
      coolantOn: false,
    },
  },
  */
];

export function getMacroDefinitionById(id: string): MacroDefinition | undefined {
  return MACRO_DEFINITIONS.find((m) => m.id === id);
}

export function getDefinitionsByCategory(category: MacroCategoryId): MacroDefinition[] {
  return MACRO_DEFINITIONS.filter((m) => m.category === category);
}
