import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useSendMdiCommand } from '@/hooks/useSendMdiCommand';
import { useMdiPreconditions, type MdiDisabledReasonKey } from '@/hooks/useMdiPreconditions';
import { usePendingWsCommandResult } from '@/hooks/usePendingWsCommandResult';
import {
  formatPresetMdiLine,
  presetDisplayLabel,
  presetMdiValues,
  presetSelectOptions,
} from '@/lib/presetMdiValues';
import { getToolIconSrc } from '@/lib/toolIcons';
import { toolFormTouchSelectTriggerClass } from '@/lib/toolFormTouchClasses';
import { cn } from '@/lib/utils';
import { formatToolMaterialUi, type Tool, type ToolPreset } from '@/types/tools';
import {
  SpindleFeedSetValueButton,
  spindleFeedSubmitTouchButtonClass,
} from '@/components/SpindleFeedSetValueButton';
import { Card } from './ui/card';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from './ui/dialog';
import { TouchSelectField } from './ui/TouchSelectField';

type ToolInfoDisplayProps = {
  tool?: Tool;
};

export function ToolInfoDisplay({ tool }: ToolInfoDisplayProps) {
  const { t } = useTranslation('tools');
  const [open, setOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [busy, setBusy] = useState(false);

  const presets = tool?.lcncguiPresets ?? [];
  const { sendMdi, appendMdiCommandHistory } = useSendMdiCommand();
  const { canMdi, reasons } = useMdiPreconditions();
  const pendingMdiRef = useRef<string | null>(null);
  const pendingMdiLineRef = useRef<string | null>(null);

  useEffect(() => {
    if (!tool) {
      setSelectedPresetId('');
      return;
    }
    const list = tool.lcncguiPresets ?? [];
    const ids = new Set(list.map((p) => p.id));
    setSelectedPresetId((prev) => (ids.has(prev) ? prev : (list[0]?.id ?? '')));
  }, [tool]);

  useEffect(() => {
    if (!open) {
      pendingMdiRef.current = null;
      pendingMdiLineRef.current = null;
      setBusy(false);
    }
  }, [open]);

  usePendingWsCommandResult(pendingMdiRef, {
    enabled: open,
    onResult: (r) => {
      pendingMdiRef.current = null;
      setBusy(false);
      if (r.ok) {
        const line = pendingMdiLineRef.current;
        pendingMdiLineRef.current = null;
        if (line) appendMdiCommandHistory(line);
        setOpen(false);
      } else {
        pendingMdiLineRef.current = null;
      }
    },
  });

  const selectedPreset = useMemo(
    () => presets.find((p) => p.id === selectedPresetId),
    [presets, selectedPresetId],
  );

  const mdiValues = useMemo(() => presetMdiValues(selectedPreset), [selectedPreset]);

  const presetMdiLine = useMemo(() => {
    if (!mdiValues || !selectedPreset) return null;
    return formatPresetMdiLine(mdiValues, presetDisplayLabel(selectedPreset));
  }, [mdiValues, selectedPreset]);

  const presetOptions = useMemo(() => presetSelectOptions(presets), [presets]);

  const handleApplyPreset = () => {
    if (!presetMdiLine || !canMdi || busy) return;
    const commandId = sendMdi(presetMdiLine, { history: 'none' });
    if (!commandId) return;
    pendingMdiRef.current = commandId;
    pendingMdiLineRef.current = presetMdiLine;
    setBusy(true);
  };

  if (!tool) {
    return (
      <Card className="w-[200px] h-[220px] flex flex-col items-center justify-center p-4">
        <div className="space-y-2 text-center">
          <div className="text-sm font-medium text-muted-foreground">{t('toolInfo.noActiveTool')}</div>
          <div className="text-xs text-muted-foreground/80">{t('toolInfo.noActiveToolHint')}</div>
        </div>
      </Card>
    );
  }

  const iconSrc = getToolIconSrc(tool);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Card className="w-[200px] h-[220px] flex flex-col items-center justify-center p-4 cursor-pointer hover:bg-muted/50 transition-colors">
          <img
            src={iconSrc}
            alt={
              tool.type
                ? t('toolDetails.altWithType', { type: tool.type })
                : t('toolDetails.altTool')
            }
            className="h-20 w-20 object-contain mb-3"
          />
          <div className="space-y-1 text-center">
            <div className="text-xl font-semibold text-foreground">{tool.id}</div>
            <div className="text-sm text-foreground/70">{tool.material}</div>
            <div className="text-sm text-foreground/70">
              {tool.diameter != null ? `Ø${tool.diameter}` : 'Ø–'}
            </div>
          </div>
        </Card>
      </DialogTrigger>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto flex flex-col">
        <ToolInfoDialogBody
          tool={tool}
          iconSrc={iconSrc}
          onClose={() => setOpen(false)}
          presets={presets}
          presetOptions={presetOptions}
          selectedPresetId={selectedPresetId}
          onSelectedPresetIdChange={setSelectedPresetId}
          presetMdiLine={presetMdiLine}
          canMdi={canMdi}
          reasons={reasons}
          busy={busy}
          onApplyPreset={handleApplyPreset}
        />
      </DialogContent>
    </Dialog>
  );
}

type ToolInfoDialogBodyProps = {
  tool: Tool;
  iconSrc: string;
  onClose: () => void;
  presets: ToolPreset[];
  presetOptions: { value: string; label: string }[];
  selectedPresetId: string;
  onSelectedPresetIdChange: (id: string) => void;
  presetMdiLine: string | null;
  canMdi: boolean;
  reasons: MdiDisabledReasonKey[];
  busy: boolean;
  onApplyPreset: () => void;
};

function ToolInfoDialogBody({
  tool,
  iconSrc,
  onClose,
  presets,
  presetOptions,
  selectedPresetId,
  onSelectedPresetIdChange,
  presetMdiLine,
  canMdi,
  reasons,
  busy,
  onApplyPreset,
}: ToolInfoDialogBodyProps) {
  const { t } = useTranslation('tools');
  const valueOk = presetMdiLine !== null;

  return (
    <>
      <div className="flex items-start justify-between gap-4 mb-4 shrink-0">
        <div>
          <div className="text-lg font-semibold text-foreground">
            #{tool.toolNumber ?? tool.id.replace(/^T/i, '')} – {tool.name}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {tool.type ?? t('toolInfo.unknownType')}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="ml-4 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={t('toolInfo.closeDialogAria')}
        >
          ✕
        </button>
      </div>
      <div className="space-y-4 min-h-0 flex-1">
        <div className="w-full flex items-center justify-center py-6">
          <img
            src={iconSrc}
            alt={
              tool.type
                ? t('toolDetails.altWithType', { type: tool.type })
                : t('toolDetails.altTool')
            }
            className="max-h-40 w-auto object-contain [mask-image:linear-gradient(to_bottom,transparent,black_10%,black_90%,transparent)] [mask-size:100%_100%] [mask-repeat:no-repeat] [mask-position:center] [webkit-mask-image:linear-gradient(to_bottom,transparent,black_10%,black_90%,transparent)] [webkit-mask-size:100%_100%] [webkit-mask-repeat:no-repeat] [webkit-mask-position:center]"
          />
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('toolInfo.id')}</span>
            <span className="font-medium">{tool.id}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('toolInfo.diameter')}</span>
            <span className="font-medium">
              {tool.diameter != null ? `${tool.diameter} mm` : '–'}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('toolInfo.material')}</span>
            <span className="font-medium">{formatToolMaterialUi(tool.material) || '–'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('toolInfo.flutes')}</span>
            <span className="font-medium">
              {tool.numberOfFlutes != null ? tool.numberOfFlutes : '–'}
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-muted-foreground">{t('toolInfo.fluteLengthLabel')}</span>
            <span className="font-medium">
              {tool.flutesLength != null ? `${tool.flutesLength} mm` : '–'}
            </span>
          </div>
          {tool.comment && (
            <div className="pt-2 text-xs text-muted-foreground/90 text-right">{tool.comment}</div>
          )}
        </div>

        <div className="space-y-2 pt-2 border-t border-border/50">
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {t('toolInfo.cutPresetSection')}
          </div>
          {presets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('toolInfo.noPresets')}</p>
          ) : (
            <>
              <TouchSelectField
                label={t('toolInfo.presetLabel')}
                value={selectedPresetId}
                onChange={onSelectedPresetIdChange}
                options={presetOptions}
                triggerClassName={toolFormTouchSelectTriggerClass}
                data-e2e="tool-info-preset-select"
              />
              {presetMdiLine && (
                <p className="text-xs text-muted-foreground font-mono">
                  MDI: {presetMdiLine}
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {presets.length > 0 && (
        <DialogFooter className="flex-col gap-3 sm:flex-col border-t border-border/50 mt-4 pt-4 shrink-0">
          {busy ? (
            <Button
              type="button"
              variant="secondary"
              size="lg"
              className={cn('w-full', spindleFeedSubmitTouchButtonClass)}
              disabled
            >
              {t('toolInfo.sending')}
            </Button>
          ) : (
            <SpindleFeedSetValueButton
              canMdi={canMdi}
              valueOk={valueOk}
              reasons={reasons}
              kind="spindle"
              invalidHint={t('toolInfo.presetNeedsRpmFeed')}
              onClick={onApplyPreset}
              variantWhenEnabled="default"
              dataE2e="tool-info-preset-apply"
            >
              {t('toolInfo.applyPreset')}
            </SpindleFeedSetValueButton>
          )}
        </DialogFooter>
      )}
    </>
  );
}
