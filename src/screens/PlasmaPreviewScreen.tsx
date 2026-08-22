import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TouchNumericPickerField } from '@/components/numeric';
import { ToolpathCanvas } from '@/components/plasma/ToolpathCanvas';
import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { usePlasmaToolpath } from '@/hooks/usePlasmaToolpath';
import { useAppStore } from '@/store';

const buttonClass =
  'rounded-md border border-white/10 bg-slate-900/60 px-4 py-2 text-sm font-semibold uppercase tracking-wide hover:border-white/25 disabled:opacity-40';

/**
 * The program preview, and run-from-line on top of it.
 *
 * Picking a line is a click on the cut itself rather than a number typed into a box — that is
 * how an operator thinks about restarting a job ("start again at that bit"), and the preview
 * already knows which line drew which cut.
 *
 * The two run types are QtPlasmaC's: HERE TO END runs the rest of the program, THIS CUTPATH
 * runs only the cut that was clicked. A lead-in is offered for HERE TO END only, because
 * upstream sends "no lead-in" for a single cutpath.
 */
export function PlasmaPreviewScreen() {
  const { t } = useTranslation('plasma');
  const commands = usePlasmaCommands();
  const { refresh } = usePlasmaToolpath();

  const toolpath = useAppStore((s) => s.plasmaToolpath);
  const error = useAppStore((s) => s.plasmaToolpathError);
  const loading = useAppStore((s) => s.plasmaToolpathLoading);
  const coordinates = useAppStore((s) => s.coordinates);
  const motionLine = useAppStore((s) => s.linuxCncStatus.program.motion_line);

  const [selectedLine, setSelectedLine] = useState<number | null>(null);
  const [leadinLength, setLeadinLength] = useState('0');
  const [leadinAngle, setLeadinAngle] = useState('0');
  const [status, setStatus] = useState<string | null>(null);
  const pendingRef = useRef<string | null>(null);

  usePendingWsCommandResult(pendingRef, {
    onResult: (result) => {
      pendingRef.current = null;
      if (result.ok) {
        const line = (result.result?.startLine as number | undefined) ?? selectedLine ?? 0;
        setStatus(t('preview.loadedFromLine', { line: line + 1 }));
        return;
      }
      setStatus(result.error?.message ?? result.error?.code ?? t('preview.runFromLineFailed'));
    },
  });

  const runFrom = (runType: 'here' | 'cut') => {
    if (selectedLine === null) return;
    const length = Number(leadinLength);
    const angle = Number(leadinAngle);
    const commandId = commands.runFromLine({
      line: selectedLine,
      runType,
      leadinLength: runType === 'here' && Number.isFinite(length) ? length : 0,
      leadinAngle: Number.isFinite(angle) ? angle : 0,
    });
    if (commandId) {
      pendingRef.current = commandId;
      setStatus(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-e2e="plasma-preview">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass} data-e2e="plasma-preview-refresh" onClick={refresh}>
          {t('preview.refresh')}
        </button>
        <span className="text-sm text-muted-foreground" data-e2e="plasma-preview-selected">
          {selectedLine === null
            ? t('preview.pickACut')
            : t('preview.selectedLine', { line: selectedLine + 1 })}
        </span>
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-preview-run-here"
          disabled={selectedLine === null}
          onClick={() => runFrom('here')}
        >
          {t('preview.hereToEnd')}
        </button>
        <button
          type="button"
          className={buttonClass}
          data-e2e="plasma-preview-run-cut"
          disabled={selectedLine === null}
          onClick={() => runFrom('cut')}
        >
          {t('preview.thisCutpath')}
        </button>
        <div className="flex items-end gap-2">
          <TouchNumericPickerField
            label={t('preview.leadinLength')}
            value={leadinLength}
            onChange={setLeadinLength}
            unit="mm"
            className="w-28"
            data-e2e="plasma-preview-leadin-length"
          />
          <TouchNumericPickerField
            label={t('preview.leadinAngle')}
            value={leadinAngle}
            onChange={setLeadinAngle}
            unit="°"
            className="w-28"
            data-e2e="plasma-preview-leadin-angle"
          />
        </div>
      </div>

      {status && (
        <div className="text-sm text-amber-300" data-e2e="plasma-preview-status">
          {status}
        </div>
      )}

      {toolpath?.notes?.warnings?.length ? (
        <ul className="space-y-1" data-e2e="plasma-preview-notes">
          {toolpath.notes.warnings.map((warning) => (
            <li
              key={`${warning.code}-${warning.directive}`}
              className="rounded-md border border-amber-400/40 bg-amber-950/20 px-3 py-1.5 text-sm text-amber-200"
              data-e2e={`plasma-preview-note-${warning.directive}`}
            >
              {warning.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="min-h-0 flex-1 rounded-md border border-white/10 bg-slate-950/40">
        {toolpath ? (
          <ToolpathCanvas
            toolpath={toolpath}
            torch={{ x: coordinates.x, y: coordinates.y }}
            activeLine={typeof motionLine === 'number' ? motionLine : null}
            selectedLine={selectedLine}
            onPickLine={setSelectedLine}
          />
        ) : (
          <div
            className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground"
            data-e2e="plasma-preview-empty"
          >
            {loading ? t('preview.loading') : error ?? t('preview.noProgram')}
          </div>
        )}
      </div>

      {toolpath && (
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          <span data-e2e="plasma-preview-path">{toolpath.path}</span>
          <span data-e2e="plasma-preview-points">
            {t('preview.points', { count: toolpath.points })}
          </span>
          {toolpath.truncated && (
            <span className="text-amber-300" data-e2e="plasma-preview-truncated">
              {t('preview.truncated')}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
