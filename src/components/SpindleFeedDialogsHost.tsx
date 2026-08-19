import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { generateCommandId, useSendCommand } from '@/api/backendCommands';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter } from '@/components/ui/dialog';
import { TouchNumericEntry, touchNumericDialogContentWideClassName } from '@/components/numeric';
import { OverrideSliderSection } from '@/components/SpindleFeedOverrideSliderSection';
import {
  SpindleFeedSetValueButton,
  spindleFeedSubmitTouchButtonClass,
} from '@/components/SpindleFeedSetValueButton';
import { eventBus } from '@/eventBus';
import { useMdiPreconditions } from '@/hooks/useMdiPreconditions';
import { useSendMdiCommand } from '@/hooks/useSendMdiCommand';
import { useWsCommandResultHistoryEffect } from '@/hooks/usePendingWsCommandResult';
import { useTouchNumericModalEscapeStack } from '@/hooks/useTouchNumericModalEscapeStack';
import {
  dialogFooterTouchButtonClass,
  trySubmitDialogFormOnEnter,
} from '@/lib/dialogFormSubmit';
import {
  parsePositiveIntFromNumericExpression,
  parseUnsignedIntFromNumericExpression,
} from '@/lib/evaluateNumericExpression';
import {
  JOG_VELOCITY_SLIDER_STEP_MM_MIN,
  JOG_VELOCITY_STEP_MM_MIN,
  MAX_JOG_VELOCITY_MM_MIN,
  MIN_JOG_VELOCITY_MM_MIN,
} from '@/lib/jogVelocity';
import { formatFeedMdiLine, formatSpindleMdiLine } from '@/lib/mdiLineFormat';
import { findLatestCommandResultForId } from '@/lib/wsCommandResults';
import { useAppStore } from '@/store';
import type { LastWsCommandResult, LinuxCncStatusRoot } from '@/store/types';

function overrideCommandErrorMessage(
  result: LastWsCommandResult,
  fallback: string,
): string {
  return result.error?.message?.trim() || result.error?.code || fallback;
}

/** At most once per `commandId` (shared `delivered` set). Returns true if handled. */
function deliverCommandOnce(
  delivered: Set<string>,
  history: LastWsCommandResult[],
  commandId: string | null,
  onResult: (result: LastWsCommandResult) => void,
): boolean {
  if (!commandId || delivered.has(commandId)) return false;
  const result = findLatestCommandResultForId(history, commandId);
  if (!result) return false;
  delivered.add(commandId);
  onResult(result);
  return true;
}

function spindleSFromStatus(status: LinuxCncStatusRoot): number {
  const raw = status.program.settings?.[2];
  const fromSetting = typeof raw === 'number' ? raw : Number(raw);
  if (raw !== undefined && raw !== null && Number.isFinite(fromSetting)) {
    return Math.round(Math.abs(fromSetting));
  }
  const sp = status.spindle?.[0]?.speed;
  const fromStat = typeof sp === 'number' ? sp : Number(sp);
  return Number.isFinite(fromStat) ? Math.round(Math.abs(fromStat)) : 0;
}

function SpindleSettingsDialog({
  open,
  onOpenChange,
  syncKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Increments each open so the form is refilled from status. */
  syncKey: number;
}) {
  const { t } = useTranslation('components');
  const showErrorToast = useAppStore((s) => s.showErrorToast);
  const sendCommand = useSendCommand();
  const { sendMdi, appendMdiCommandHistory } = useSendMdiCommand();
  const { canMdi, reasons } = useMdiPreconditions();
  const { onOuterEscapeKeyDown, touchNumericStackProps } = useTouchNumericModalEscapeStack({
    outerOpen: open,
  });

  const [rpmInput, setRpmInput] = useState('0');
  const [overridePct, setOverridePct] = useState(100);

  const pendingMdiRef = useRef<string | null>(null);
  const pendingMdiLineRef = useRef<string | null>(null);
  const pendingOverrideRef = useRef<string | null>(null);
  const deliveredRef = useRef(new Set<string>());

  useEffect(() => {
    if (!open) {
      pendingMdiRef.current = null;
      pendingMdiLineRef.current = null;
      pendingOverrideRef.current = null;
      deliveredRef.current.clear();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const status = useAppStore.getState().linuxCncStatus as LinuxCncStatusRoot;
    const sRpm = spindleSFromStatus(status);
    setRpmInput(String(sRpm));
    const ovRaw = Math.round((status.spindle?.[0]?.override ?? 1) * 100);
    const ov = Math.min(200, Math.max(1, ovRaw));
    setOverridePct(Number.isFinite(ov) ? ov : 100);
  }, [open, syncKey]);

  useWsCommandResultHistoryEffect((history) => {
    if (
      deliverCommandOnce(deliveredRef.current, history, pendingMdiRef.current, (r) => {
        pendingMdiRef.current = null;
        if (r.ok) {
          const line = pendingMdiLineRef.current;
          pendingMdiLineRef.current = null;
          if (line) appendMdiCommandHistory(line);
          onOpenChange(false);
        } else {
          pendingMdiLineRef.current = null;
        }
      })
    ) {
      return;
    }
    deliverCommandOnce(deliveredRef.current, history, pendingOverrideRef.current, (r) => {
      pendingOverrideRef.current = null;
      if (r.ok) {
        onOpenChange(false);
      } else {
        showErrorToast({
          message: overrideCommandErrorMessage(r, t('spindleFeed.overrideFailed')),
          kind: r.error?.code ?? 'spindle_override_failed',
        });
      }
    });
  }, open);

  const sValueOk = parseUnsignedIntFromNumericExpression(rpmInput) !== null;
  const canSendS = canMdi && sValueOk;

  const handleSendS = () => {
    const n = parseUnsignedIntFromNumericExpression(rpmInput);
    if (n === null) return;
    const line = formatSpindleMdiLine(n, t('spindleFeed.rpmLabel'));
    const id = sendMdi(line, { history: 'none' });
    if (!id) return;
    pendingMdiRef.current = id;
    pendingMdiLineRef.current = line;
  };

  const handleApplyOverride = () => {
    const clamped = Math.min(200, Math.max(1, overridePct));
    const id = generateCommandId();
    pendingOverrideRef.current = id;
    sendCommand(
      'machine',
      'spindle_override',
      {
        factor: clamped / 100,
        spindle: 0,
      },
      id,
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('spindleFeed.spindleTitle')}
        className={touchNumericDialogContentWideClassName}
        onEscapeKeyDown={onOuterEscapeKeyDown}
        onKeyDown={(e) => trySubmitDialogFormOnEnter(e, canSendS, handleSendS)}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-8 gap-6 items-start min-h-0 flex-1">
          <div className="flex flex-col gap-3 min-w-0 min-h-0">
            <TouchNumericEntry
              id="spindle-rpm-input"
              value={rpmInput}
              onChange={setRpmInput}
              label={t('spindleFeed.rpmLabel')}
              keypadMode="always"
              showPreview
              integerOnly
              layoutSize="default"
              data-e2e="spindle-rpm-touch-input"
              focusSelectSessionKey={open ? syncKey : undefined}
            />
            <SpindleFeedSetValueButton
              canMdi={canMdi}
              valueOk={sValueOk}
              reasons={reasons}
              kind="spindle"
              invalidHint={t('spindleFeed.invalidSpindleHint')}
              variantWhenEnabled="default"
              onClick={handleSendS}
            >
              {t('spindleFeed.setSpindle')}
            </SpindleFeedSetValueButton>
          </div>

          <div className="flex flex-col gap-4 min-w-0">
            <OverrideSliderSection
              label={t('spindleFeed.overridePercent')}
              currentLabel={t('spindleFeed.current')}
              value={overridePct}
              min={1}
              max={200}
              onValueChange={setOverridePct}
              ariaLabel={t('spindleFeed.spindleOverrideAria')}
              sliderE2e="spindle-override-slider"
              valuePickerE2e="spindle-override-percent-picker"
              onPickerDialogOpenChange={touchNumericStackProps.onDialogOpenChange}
            />
            <Button
              type="button"
              size="lg"
              className={spindleFeedSubmitTouchButtonClass}
              onClick={handleApplyOverride}
              data-e2e="spindle-apply-override"
            >
              {t('spindleFeed.applyOverride')}
            </Button>
          </div>
        </div>

        <DialogFooter className="mt-auto pt-3 border-t border-border/50 shrink-0 gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={dialogFooterTouchButtonClass}
            onClick={() => onOpenChange(false)}
          >
            {t('spindleFeed.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type PendingFeedOverrides = {
  feedId: string;
  rapidId: string;
};

function FeedSettingsDialog({
  open,
  onOpenChange,
  syncKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  syncKey: number;
}) {
  const { t } = useTranslation('components');
  const showErrorToast = useAppStore((s) => s.showErrorToast);
  const sendCommand = useSendCommand();
  const { sendMdi, appendMdiCommandHistory } = useSendMdiCommand();
  const { canMdi, reasons } = useMdiPreconditions();
  const { onOuterEscapeKeyDown, touchNumericStackProps } = useTouchNumericModalEscapeStack({
    outerOpen: open,
  });

  const [feedInput, setFeedInput] = useState('0');
  const [overridePct, setOverridePct] = useState(100);
  const [rapidOverridePct, setRapidOverridePct] = useState(100);
  const jogVelocityMmPerMin = useAppStore((s) => s.jogVelocityMmPerMin);
  const setJogVelocityMmPerMin = useAppStore((s) => s.setJogVelocityMmPerMin);

  const pendingMdiRef = useRef<string | null>(null);
  const pendingMdiLineRef = useRef<string | null>(null);
  const pendingOverridesRef = useRef<PendingFeedOverrides | null>(null);
  const deliveredRef = useRef(new Set<string>());

  useEffect(() => {
    if (!open) {
      pendingMdiRef.current = null;
      pendingMdiLineRef.current = null;
      pendingOverridesRef.current = null;
      deliveredRef.current.clear();
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const status = useAppStore.getState().linuxCncStatus as LinuxCncStatusRoot;
    const fRaw = status.program.settings?.[1] ?? 0;
    const f = Number.isFinite(fRaw) ? fRaw : 0;
    setFeedInput(String(Math.max(0, Math.round(f))));
    const ovRaw = Math.round((status.overrides.feedrate ?? 1) * 100);
    const ov = Math.min(200, Math.max(1, ovRaw));
    setOverridePct(Number.isFinite(ov) ? ov : 100);
    const rapidRaw = Math.round((status.overrides.rapidrate ?? 1) * 100);
    const rapidOv = Math.min(100, Math.max(0, rapidRaw));
    setRapidOverridePct(Number.isFinite(rapidOv) ? rapidOv : 100);
  }, [open, syncKey]);

  useWsCommandResultHistoryEffect((history) => {
    if (
      deliverCommandOnce(deliveredRef.current, history, pendingMdiRef.current, (r) => {
        pendingMdiRef.current = null;
        if (r.ok) {
          const line = pendingMdiLineRef.current;
          pendingMdiLineRef.current = null;
          if (line) appendMdiCommandHistory(line);
          onOpenChange(false);
        } else {
          pendingMdiLineRef.current = null;
        }
      })
    ) {
      return;
    }
    const pending = pendingOverridesRef.current;
    if (!pending) return;
    const feedResult = findLatestCommandResultForId(history, pending.feedId);
    const rapidResult = findLatestCommandResultForId(history, pending.rapidId);
    if (!feedResult || !rapidResult) return;
    const groupKey = `${pending.feedId}\0${pending.rapidId}`;
    if (deliveredRef.current.has(groupKey)) return;
    deliveredRef.current.add(groupKey);
    pendingOverridesRef.current = null;
    if (!feedResult.ok) {
      showErrorToast({
        message: overrideCommandErrorMessage(feedResult, t('spindleFeed.overrideFailed')),
        kind: feedResult.error?.code ?? 'feed_override_failed',
      });
      return;
    }
    if (!rapidResult.ok) {
      showErrorToast({
        message: overrideCommandErrorMessage(rapidResult, t('spindleFeed.overrideFailed')),
        kind: rapidResult.error?.code ?? 'rapid_override_failed',
      });
      return;
    }
    onOpenChange(false);
  }, open);

  const fValueOk = parsePositiveIntFromNumericExpression(feedInput) !== null;
  const canSendF = canMdi && fValueOk;

  const handleSendF = () => {
    const n = parsePositiveIntFromNumericExpression(feedInput);
    if (n === null) return;
    const line = formatFeedMdiLine(n, t('spindleFeed.feedLabel'));
    const id = sendMdi(line, { history: 'none' });
    if (!id) return;
    pendingMdiRef.current = id;
    pendingMdiLineRef.current = line;
  };

  const handleApplyOverrides = () => {
    const feedClamped = Math.min(200, Math.max(1, overridePct));
    const rapidClamped = Math.min(100, Math.max(0, rapidOverridePct));
    const feedId = generateCommandId();
    const rapidId = generateCommandId();
    pendingOverridesRef.current = { feedId, rapidId };
    sendCommand('machine', 'feed_override', { factor: feedClamped / 100 }, feedId);
    sendCommand('machine', 'rapid_override', { factor: rapidClamped / 100 }, rapidId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={t('spindleFeed.feedTitle')}
        className={touchNumericDialogContentWideClassName}
        onEscapeKeyDown={onOuterEscapeKeyDown}
        onKeyDown={(e) => trySubmitDialogFormOnEnter(e, canSendF, handleSendF)}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 lg:gap-8 gap-6 items-start min-h-0 flex-1">
          <div className="flex flex-col gap-3 min-w-0 min-h-0">
            <TouchNumericEntry
              id="feed-f-input"
              value={feedInput}
              onChange={setFeedInput}
              label={t('spindleFeed.feedLabel')}
              keypadMode="always"
              showPreview
              integerOnly
              layoutSize="default"
              data-e2e="feed-f-touch-input"
              focusSelectSessionKey={open ? syncKey : undefined}
            />
            <SpindleFeedSetValueButton
              canMdi={canMdi}
              valueOk={fValueOk}
              reasons={reasons}
              kind="feed"
              invalidHint={t('spindleFeed.invalidFeedHint')}
              variantWhenEnabled="default"
              onClick={handleSendF}
            >
              {t('spindleFeed.setFeed')}
            </SpindleFeedSetValueButton>
          </div>

          <div className="flex flex-col gap-4 min-w-0 min-h-0">
            <OverrideSliderSection
              label={t('spindleFeed.feedOverrideLabel')}
              currentLabel={t('spindleFeed.current')}
              value={overridePct}
              min={1}
              max={200}
              onValueChange={setOverridePct}
              ariaLabel={t('spindleFeed.feedOverrideAria')}
              sliderE2e="feed-feed-override-slider"
              valuePickerE2e="feed-feed-override-percent-picker"
              onPickerDialogOpenChange={touchNumericStackProps.onDialogOpenChange}
            />
            <OverrideSliderSection
              label={t('spindleFeed.rapidOverrideLabel')}
              currentLabel={t('spindleFeed.current')}
              value={rapidOverridePct}
              min={0}
              max={100}
              onValueChange={setRapidOverridePct}
              ariaLabel={t('spindleFeed.rapidOverrideAria')}
              sliderE2e="feed-rapid-override-slider"
              valuePickerE2e="feed-rapid-override-percent-picker"
              onPickerDialogOpenChange={touchNumericStackProps.onDialogOpenChange}
              showDivider
            />
            <OverrideSliderSection
              label={t('spindleFeed.jogSpeedLabel')}
              currentLabel={t('spindleFeed.current')}
              value={jogVelocityMmPerMin}
              min={MIN_JOG_VELOCITY_MM_MIN}
              max={MAX_JOG_VELOCITY_MM_MIN}
              step={JOG_VELOCITY_STEP_MM_MIN}
              sliderStep={JOG_VELOCITY_SLIDER_STEP_MM_MIN}
              unit="mm/min"
              onValueChange={setJogVelocityMmPerMin}
              ariaLabel={t('spindleFeed.jogSpeedAria')}
              sliderE2e="feed-jog-speed-slider"
              valuePickerE2e="feed-jog-speed-picker"
              onPickerDialogOpenChange={touchNumericStackProps.onDialogOpenChange}
              showDivider
            />
            <Button
              type="button"
              size="lg"
              className={`${spindleFeedSubmitTouchButtonClass} mt-8`}
              onClick={handleApplyOverrides}
              data-e2e="feed-apply-overrides"
            >
              {t('spindleFeed.applyOverrides')}
            </Button>
          </div>
        </div>

        <DialogFooter className="mt-auto pt-3 border-t border-border/50 shrink-0 gap-3">
          <Button
            type="button"
            variant="outline"
            size="lg"
            className={dialogFooterTouchButtonClass}
            onClick={() => onOpenChange(false)}
          >
            {t('spindleFeed.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SpindleFeedDialogsHost() {
  const [spindleOpen, setSpindleOpen] = useState(false);
  const [feedOpen, setFeedOpen] = useState(false);
  const [spindleSyncKey, setSpindleSyncKey] = useState(0);
  const [feedSyncKey, setFeedSyncKey] = useState(0);

  useEffect(() => {
    const unsubSpindle = eventBus.subscribe('ui.spindle.openDialog', () => {
      setSpindleSyncKey((k) => k + 1);
      setSpindleOpen(true);
    });
    const unsubFeed = eventBus.subscribe('ui.feed.openDialog', () => {
      setFeedSyncKey((k) => k + 1);
      setFeedOpen(true);
    });
    return () => {
      unsubSpindle();
      unsubFeed();
    };
  }, []);

  return (
    <>
      <SpindleSettingsDialog
        open={spindleOpen}
        onOpenChange={setSpindleOpen}
        syncKey={spindleSyncKey}
      />
      <FeedSettingsDialog open={feedOpen} onOpenChange={setFeedOpen} syncKey={feedSyncKey} />
    </>
  );
}
