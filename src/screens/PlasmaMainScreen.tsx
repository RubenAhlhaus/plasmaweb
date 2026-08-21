import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { CoordinatesDisplay } from '@/components/CoordinatesDisplay';
import { DirectionalControl } from '@/components/DirectionalControl';
import { IncrementSelector } from '@/components/IncrementSelector';
import { CutRecoveryPad } from '@/components/plasma/CutRecoveryPad';
import { HeightOverrideControl } from '@/components/plasma/HeightOverrideControl';
import { PlasmaLed } from '@/components/plasma/PlasmaLed';
import { PlasmaReadout } from '@/components/plasma/PlasmaReadout';
import { PlasmaStatisticsPanel } from '@/components/plasma/PlasmaStatisticsPanel';
import { PlasmaToggleButton } from '@/components/plasma/PlasmaToggleButton';
import { eventBus } from '@/eventBus';
import { useJogPanelSize } from '@/hooks/useJogPanelSize';
import { usePlasmaCommands } from '@/hooks/usePlasmaCommands';
import { usePlasmacFlag, usePlasmacNumber, usePlasmacPin } from '@/hooks/usePlasmaPins';
import { useAppStore } from '@/store';

/**
 * QtPlasmaC's MAIN tab.
 *
 * Everything shown here is a HAL pin: no value is computed in the browser, and every
 * control writes a setpoint and then waits for the pin to come back. Losing the WebSocket
 * therefore blanks the display but cannot change machine state — torch enable, THC enable
 * and friends are latched in HAL, not here.
 */
export function PlasmaMainScreen() {
  const { t } = useTranslation('plasma');
  const jogPanelRef = useRef<HTMLDivElement>(null);
  const jogSize = useJogPanelSize(jogPanelRef);
  const commands = usePlasmaCommands();

  const available = useAppStore((s) => s.plasmaAvailable);
  const plasmaState = useAppStore((s) => s.plasmaState);

  const arcVoltage = usePlasmacNumber('arc-voltage-out');
  const targetVolts = usePlasmacNumber('target-volts');
  const zHeight = usePlasmacNumber('z-height');
  const feedRate = usePlasmacNumber('current-feed-rate');

  const torchOn = usePlasmacFlag('torch-on');
  const arcOk = usePlasmacFlag('arc-ok-out');
  const thcActive = usePlasmacFlag('thc-active');
  const ledUp = usePlasmacFlag('led-up');
  const ledDown = usePlasmacFlag('led-down');
  const cornerLocked = usePlasmacFlag('cornerlock-is-locked');
  const voidLocked = usePlasmacFlag('voidlock-is-locked');
  // Sensors are one shared "something tripped" output on plasmac; float/ohmic/breakaway
  // arrive debounced on the input side, so both are shown.
  const sensorActive = usePlasmacFlag('sensor-active');
  const floatSwitch = usePlasmacPin('float-switch');
  const ohmicProbe = usePlasmacPin('ohmic-probe');
  const breakaway = usePlasmacPin('breakaway');

  const torchEnabled = usePlasmacFlag('torch-enable');
  const thcEnabled = usePlasmacFlag('thc-enabled');
  const cornerlockEnable = usePlasmacFlag('cornerlock-enable');
  const voidlockEnable = usePlasmacFlag('voidlock-enable');
  const autoVolts = usePlasmacFlag('use-auto-volts');
  const meshEnable = usePlasmacFlag('mesh-enable');
  // Probing and recovery only make sense while the program is paused or idle, and plasmac
  // itself is the authority on that — hence `paused-motion`, not a flag of our own.
  const pausedMotion = usePlasmacFlag('paused-motion');
  const programPaused = usePlasmacFlag('program-is-paused');

  if (!available) {
    return (
      <div
        className="flex h-full items-center justify-center text-sm text-muted-foreground"
        data-e2e="plasma-unavailable"
      >
        {t('unavailable')}
      </div>
    );
  }

  // min-h + leading-tight rather than a fixed height: "Cycle start" and "Torch pulse" wrap
  // to two lines in German and in narrow kiosk widths.
  const cycleButtonClass =
    'flex min-h-[3.25rem] flex-1 items-center justify-center rounded-lg border border-white/10 bg-slate-900/60 px-3 py-2 text-center text-sm font-semibold uppercase leading-tight tracking-wide text-foreground transition-colors hover:border-white/25';

  return (
    <div className="grid h-full min-h-0 gap-4 lg:grid-cols-[minmax(0,1fr)_25rem]" data-e2e="plasma-main">
      <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <CoordinatesDisplay />

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <PlasmaReadout
            label={t('readout.arcVoltage')}
            value={arcVoltage}
            unit={t('units.volts')}
            emphasis
            data-e2e="plasma-arc-voltage"
          />
          <PlasmaReadout
            label={t('readout.targetVoltage')}
            value={targetVolts}
            unit={t('units.volts')}
            data-e2e="plasma-target-voltage"
          />
          <PlasmaReadout
            label={t('readout.zHeight')}
            value={zHeight}
            decimals={2}
            data-e2e="plasma-z-height"
          />
          <PlasmaReadout
            label={t('readout.cutFeedRate')}
            value={feedRate}
            decimals={0}
            data-e2e="plasma-feed-rate"
          />
        </div>

        <section className="rounded-lg border border-white/5 bg-slate-900/50 px-3 py-3">
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-muted-foreground">
              {t('state.title')}
            </span>
            <span className="font-mono text-sm text-foreground" data-e2e="plasma-state-name">
              {plasmaState.stateName ?? '—'}
            </span>
            {plasmaState.stopTypeName && plasmaState.stopTypeName !== 'NONE' && (
              <span className="text-xs uppercase text-amber-300" data-e2e="plasma-stop-type">
                {plasmaState.stopTypeName}
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-y-2 sm:grid-cols-4">
            <PlasmaLed label={t('led.torchOn')} on={torchOn} tone="red" data-e2e="plasma-led-torch-on" />
            <PlasmaLed label={t('led.arcOk')} on={arcOk} data-e2e="plasma-led-arc-ok" />
            <PlasmaLed label={t('led.thcActive')} on={thcActive} tone="blue" data-e2e="plasma-led-thc-active" />
            <PlasmaLed label={t('led.sensorActive')} on={sensorActive} tone="amber" data-e2e="plasma-led-sensor" />
            <PlasmaLed label={t('led.up')} on={ledUp} tone="blue" data-e2e="plasma-led-up" />
            <PlasmaLed label={t('led.down')} on={ledDown} tone="blue" data-e2e="plasma-led-down" />
            <PlasmaLed label={t('led.cornerLocked')} on={cornerLocked} tone="amber" data-e2e="plasma-led-cornerlock" />
            <PlasmaLed label={t('led.voidLocked')} on={voidLocked} tone="amber" data-e2e="plasma-led-voidlock" />
            <PlasmaLed
              label={t('led.float')}
              on={floatSwitch === undefined ? undefined : Boolean(floatSwitch)}
              tone="amber"
              data-e2e="plasma-led-float"
            />
            <PlasmaLed
              label={t('led.ohmic')}
              on={ohmicProbe === undefined ? undefined : Boolean(ohmicProbe)}
              tone="amber"
              data-e2e="plasma-led-ohmic"
            />
            <PlasmaLed
              label={t('led.breakaway')}
              on={breakaway === undefined ? undefined : Boolean(breakaway)}
              tone="red"
              data-e2e="plasma-led-breakaway"
            />
          </div>
        </section>

        <HeightOverrideControl />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <PlasmaToggleButton
            label={t('toggle.torchEnable')}
            active={torchEnabled}
            onToggle={(next) => commands.torchEnable(next)}
            data-e2e="plasma-toggle-torch"
          />
          <PlasmaToggleButton
            label={t('toggle.thcEnable')}
            active={thcEnabled}
            onToggle={(next) => commands.thcEnable(next)}
            data-e2e="plasma-toggle-thc"
          />
          <PlasmaToggleButton
            label={t('toggle.autoVolts')}
            active={autoVolts}
            onToggle={(next) => commands.setEnable('autoVolts', next)}
            data-e2e="plasma-toggle-auto-volts"
          />
          <PlasmaToggleButton
            label={t('toggle.cornerLock')}
            active={cornerlockEnable}
            onToggle={(next) => commands.setEnable('cornerlock', next)}
            data-e2e="plasma-toggle-cornerlock"
          />
          <PlasmaToggleButton
            label={t('toggle.voidLock')}
            active={voidlockEnable}
            onToggle={(next) => commands.setEnable('voidlock', next)}
            data-e2e="plasma-toggle-voidlock"
          />
          <PlasmaToggleButton
            label={t('toggle.mesh')}
            active={meshEnable}
            onToggle={(next) => commands.setEnable('mesh', next)}
            data-e2e="plasma-toggle-mesh"
          />
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            className={cycleButtonClass}
            data-e2e="plasma-cycle-start"
            onClick={() => eventBus.publish('ui.program.cycleStart', { source: 'plasmaScreen' })}
          >
            {t('cycle.start')}
          </button>
          <button
            type="button"
            className={cycleButtonClass}
            data-e2e="plasma-cycle-pause"
            onClick={() => eventBus.publish('ui.program.pause', { source: 'plasmaScreen' })}
          >
            {t('cycle.pause')}
          </button>
          <button
            type="button"
            className={cycleButtonClass}
            data-e2e="plasma-cycle-stop"
            onClick={() => eventBus.publish('ui.program.stop', { source: 'plasmaScreen' })}
          >
            {t('cycle.stop')}
          </button>
          <button
            type="button"
            className={cycleButtonClass}
            data-e2e="plasma-probe-test"
            // A fixed five seconds, the way QtPlasmaC's default PROBE TEST button is
            // configured; pressing again while it runs aborts it.
            onClick={() => commands.probeTest(5)}
          >
            {t('test.probe')}
          </button>
          <button
            type="button"
            className={cycleButtonClass}
            data-e2e="plasma-ohmic-test"
            onPointerDown={() => commands.ohmicTest(true)}
            onPointerUp={() => commands.ohmicTest(false)}
            onPointerLeave={() => commands.ohmicTest(false)}
          >
            {t('test.ohmic')}
          </button>
          <button
            type="button"
            className={cycleButtonClass}
            data-e2e="plasma-torch-pulse"
            // Momentary, exactly like QtPlasmaC's button: press raises the pulse pins,
            // release drops them again.
            onPointerDown={() => commands.torchPulse('press')}
            onPointerUp={() => commands.torchPulse('release')}
            onPointerLeave={() => commands.torchPulse('release')}
          >
            {t('cycle.torchPulse')}
          </button>
        </div>
      </div>

      <div ref={jogPanelRef} className="flex min-h-0 flex-col gap-4 overflow-y-auto">
        <CutRecoveryPad paused={programPaused || pausedMotion} />
        <div className="flex items-start gap-3">
          {/* The selector is a fixed-width column of increments; letting it shrink clips
              the labels, so the jog pad takes the remaining space instead. */}
          <div className="flex-shrink-0">
            <IncrementSelector size={jogSize} />
          </div>
          <div className="min-w-0 flex-1">
            <DirectionalControl size={jogSize} />
          </div>
        </div>
        <PlasmaStatisticsPanel />
      </div>
    </div>
  );
}
