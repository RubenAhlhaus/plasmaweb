import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TouchNumericPickerField } from '@/components/numeric';

/** The segment kinds the backend reports, and the fields each one needs beyond the last point. */
export const LINE_SEGMENT_FIELDS: Record<string, string[]> = {
  point: ['xEnd', 'yEnd'],
  angle: ['length', 'angle'],
  arc3: ['xNext', 'yNext', 'xEnd', 'yEnd'],
  arcRadius: ['xEnd', 'yEnd', 'radius', 'arcType'],
  arcAngleRadius: ['length', 'angle', 'radius', 'arcType'],
};

export type LineSegment = { kind: string } & Record<string, string | number>;

export type ConversationalLineEditorProps = {
  segments: LineSegment[];
  onChange: (segments: LineSegment[]) => void;
  startX: string;
  startY: string;
  onStartChange: (axis: 'x' | 'y', value: string) => void;
};

const buttonClass =
  'rounded-md border border-border/40 bg-card px-3 py-2 text-xs font-semibold uppercase tracking-wide hover:border-border/70 disabled:opacity-40';

/**
 * A cut made of lines and arcs, built one segment at a time.
 *
 * Each segment starts where the last one ended — that is upstream's model and it is why a
 * segment only carries its own end point, not both ends. `arcType` is the G-code word (02 or 03),
 * so the direction shown here is the direction the machine will turn.
 */
export function ConversationalLineEditor({
  segments,
  onChange,
  startX,
  startY,
  onStartChange,
}: ConversationalLineEditorProps) {
  const { t } = useTranslation('plasma');
  const [kind, setKind] = useState<string>('point');

  const addSegment = () => {
    const fields = LINE_SEGMENT_FIELDS[kind] ?? [];
    const segment: LineSegment = { kind };
    for (const field of fields) {
      segment[field] = field === 'arcType' ? '02' : '0';
    }
    onChange([...segments, segment]);
  };

  const setField = (index: number, field: string, value: string) => {
    onChange(
      segments.map((segment, position) =>
        position === index ? { ...segment, [field]: value } : segment,
      ),
    );
  };

  return (
    <div className="flex flex-col gap-3" data-e2e="plasma-line-editor">
      <div className="grid grid-cols-2 gap-3">
        <TouchNumericPickerField
          label={t('conversational.field.startX')}
          value={startX}
          onChange={(value) => onStartChange('x', value)}
          data-e2e="plasma-line-startX"
        />
        <TouchNumericPickerField
          label={t('conversational.field.startY')}
          value={startY}
          onChange={(value) => onStartChange('y', value)}
          data-e2e="plasma-line-startY"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {Object.keys(LINE_SEGMENT_FIELDS).map((name) => (
          <button
            key={name}
            type="button"
            data-e2e={`plasma-line-kind-${name}`}
            className={`rounded px-2 py-1 text-xs uppercase tracking-wide ${
              kind === name ? 'bg-card text-foreground' : 'text-muted-foreground'
            }`}
            onClick={() => setKind(name)}
          >
            {t(`conversational.segment.${name}`, { defaultValue: name })}
          </button>
        ))}
        <button type="button" className={buttonClass} data-e2e="plasma-line-add" onClick={addSegment}>
          {t('conversational.addSegment')}
        </button>
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-line-remove"
          disabled={segments.length === 0}
          onClick={() => onChange(segments.slice(0, -1))}
        >
          {t('conversational.removeSegment')}
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {segments.map((segment, index) => (
          <div
            key={index}
            className="rounded-md border border-border/40 p-2"
            data-e2e={`plasma-line-segment-${index}`}
          >
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
              {index + 1}. {t(`conversational.segment.${segment.kind}`, { defaultValue: segment.kind })}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(LINE_SEGMENT_FIELDS[segment.kind] ?? []).map((field) =>
                field === 'arcType' ? (
                  <div key={field} className="flex items-end gap-1">
                    {['02', '03'].map((value) => (
                      <button
                        key={value}
                        type="button"
                        data-e2e={`plasma-line-segment-${index}-arcType-${value}`}
                        className={`flex-1 rounded px-2 py-2 text-xs uppercase ${
                          String(segment[field]) === value
                            ? 'bg-card text-foreground'
                            : 'text-muted-foreground'
                        }`}
                        onClick={() => setField(index, field, value)}
                      >
                        {t(`conversational.arcType.${value}`)}
                      </button>
                    ))}
                  </div>
                ) : (
                  <TouchNumericPickerField
                    key={field}
                    label={t(`conversational.field.${field}`, { defaultValue: field })}
                    value={String(segment[field] ?? '')}
                    onChange={(value) => setField(index, field, value)}
                    data-e2e={`plasma-line-segment-${index}-${field}`}
                  />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
