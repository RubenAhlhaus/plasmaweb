import { useTranslation } from 'react-i18next';
import { AppTooltip } from '@/components/AppTooltip';
import { Button } from './ui/button';
import type { MouseEvent, PointerEvent } from 'react';
import { useEffect, useRef } from 'react';
import { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } from 'lucide-react';
import { eventBus } from '@/eventBus';
import type { UiJogRequest } from '@/api/jogTypes';
import {
  jogDirectionalButtonClassName,
  jogDirectionalCenterClassName,
  jogDirectionalIconClassName,
  jogDirectionalPadClassName,
  jogDirectionalRowClassName,
  jogDirectionalZColumnClassName,
} from '@/lib/jogControlSizeClasses';
import type { JogControlSize } from '@/lib/jogControlSize';
import { useJogPreconditions } from '@/hooks/useJogPreconditions';
import { useAppStore } from '@/store';

type DirectionalControlProps = {
  size?: JogControlSize;
};

export function DirectionalControl({ size = 'compact' }: DirectionalControlProps) {
  const { t } = useTranslation('components');
  const { canJog, tooltip } = useJogPreconditions();
  const jogMode = useAppStore((s) => s.jogMode);
  const continuousHold = jogMode === 'continuous';
  const buttonClassName = jogDirectionalButtonClassName(size, { continuousHold });
  const activeContinuousAxesRef = useRef<Set<UiJogRequest['axis']>>(new Set());

  const getTooltipText = (defaultTitle?: string) => {
    if (!canJog && tooltip) {
      return tooltip;
    }
    return defaultTitle ?? '';
  };

  const onJogClick = (request: UiJogRequest) => {
    eventBus.publish('jog.move', request);
  };

  const onContinuousJogStart = (request: UiJogRequest, pointerId: number, target: EventTarget & Element) => {
    target.setPointerCapture?.(pointerId);
    activeContinuousAxesRef.current.add(request.axis);
    eventBus.publish('jog.move', request);
  };

  const onContinuousJogStop = (axis: UiJogRequest['axis'], pointerId: number, target: EventTarget & Element) => {
    if (target.hasPointerCapture?.(pointerId)) {
      target.releasePointerCapture(pointerId);
    }
    activeContinuousAxesRef.current.delete(axis);
    eventBus.publish('jog.stop', { axis });
  };

  useEffect(() => {
    if (jogMode !== 'continuous') {
      for (const axis of activeContinuousAxesRef.current) {
        eventBus.publish('jog.stop', { axis });
      }
      activeContinuousAxesRef.current.clear();
      return;
    }

    const stopAllActiveAxes = () => {
      for (const axis of activeContinuousAxesRef.current) {
        eventBus.publish('jog.stop', { axis });
      }
      activeContinuousAxesRef.current.clear();
    };

    const onWindowBlur = () => {
      stopAllActiveAxes();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        stopAllActiveAxes();
      }
    };

    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopAllActiveAxes();
    };
  }, [jogMode]);

  const getJogButtonProps = (request: UiJogRequest) => {
    if (continuousHold) {
      return {
        onPointerDown: (event: PointerEvent<Element>) => {
          if (event.button !== 0) return;
          // Block touch long-press → contextmenu (cancels hold jog).
          event.preventDefault();
          onContinuousJogStart(request, event.pointerId, event.currentTarget);
        },
        onPointerUp: (event: PointerEvent<Element>) => {
          onContinuousJogStop(request.axis, event.pointerId, event.currentTarget);
        },
        onPointerCancel: (event: PointerEvent<Element>) => {
          onContinuousJogStop(request.axis, event.pointerId, event.currentTarget);
        },
        onContextMenu: (event: MouseEvent<Element>) => {
          event.preventDefault();
        },
      };
    }

    return {
      onClick: () => onJogClick(request),
    };
  };

  return (
    <div className={jogDirectionalRowClassName(size)}>
      <AppTooltip
        as="div"
        className={jogDirectionalPadClassName(size)}
        content={!canJog && tooltip ? tooltip : ''}
        disabled={canJog}
      >
        {/* Center */}
        <div className="absolute z-10">
          <div className={jogDirectionalCenterClassName(size)} />
        </div>

        {/* Up (Y-axis positive) */}
        <AppTooltip
          className="absolute top-0 left-1/2 -translate-x-1/2 z-20"
          content={getTooltipText(t('jogDirectional.yPositive'))}
        >
          <Button
            variant="surface"
            size="icon"
            className={buttonClassName}
            data-e2e="jog-y-positive"
            aria-label={t('jogDirectional.yPositive')}
            disabled={!canJog}
            aria-disabled={!canJog}
            {...getJogButtonProps({ axis: 'y', direction: 'positive' })}
          >
            <ArrowUp className={jogDirectionalIconClassName(size)} />
          </Button>
        </AppTooltip>

        {/* Down (Y-axis negative) */}
        <AppTooltip
          className="absolute bottom-0 left-1/2 -translate-x-1/2 z-20"
          content={getTooltipText(t('jogDirectional.yNegative'))}
        >
          <Button
            variant="surface"
            size="icon"
            className={buttonClassName}
            data-e2e="jog-y-negative"
            aria-label={t('jogDirectional.yNegative')}
            disabled={!canJog}
            aria-disabled={!canJog}
            {...getJogButtonProps({ axis: 'y', direction: 'negative' })}
          >
            <ArrowDown className={jogDirectionalIconClassName(size)} />
          </Button>
        </AppTooltip>

        {/* Left (X-axis negative) */}
        <AppTooltip
          className="absolute left-0 top-1/2 -translate-y-1/2 z-20"
          content={getTooltipText(t('jogDirectional.xNegative'))}
        >
          <Button
            variant="surface"
            size="icon"
            className={buttonClassName}
            data-e2e="jog-x-negative"
            aria-label={t('jogDirectional.xNegative')}
            disabled={!canJog}
            aria-disabled={!canJog}
            {...getJogButtonProps({ axis: 'x', direction: 'negative' })}
          >
            <ArrowLeft className={jogDirectionalIconClassName(size)} />
          </Button>
        </AppTooltip>

        {/* Right (X-axis positive) */}
        <AppTooltip
          className="absolute right-0 top-1/2 -translate-y-1/2 z-20"
          content={getTooltipText(t('jogDirectional.xPositive'))}
        >
          <Button
            variant="surface"
            size="icon"
            className={buttonClassName}
            data-e2e="jog-x-positive"
            aria-label={t('jogDirectional.xPositive')}
            disabled={!canJog}
            aria-disabled={!canJog}
            {...getJogButtonProps({ axis: 'x', direction: 'positive' })}
          >
            <ArrowRight className={jogDirectionalIconClassName(size)} />
          </Button>
        </AppTooltip>
      </AppTooltip>

      {/* Z axis: top/bottom flush with jog pad */}
      <AppTooltip
        as="div"
        className={jogDirectionalZColumnClassName(size)}
        content={!canJog && tooltip ? tooltip : ''}
        disabled={canJog}
      >
        <AppTooltip content={getTooltipText(t('jogDirectional.zPositive'))}>
          <Button
            variant="surface"
            size="icon"
            className={buttonClassName}
            data-e2e="jog-z-positive"
            aria-label={t('jogDirectional.zPositive')}
            disabled={!canJog}
            aria-disabled={!canJog}
            {...getJogButtonProps({ axis: 'z', direction: 'positive' })}
          >
            <ArrowUp className={jogDirectionalIconClassName(size)} />
          </Button>
        </AppTooltip>
        <AppTooltip content={getTooltipText(t('jogDirectional.zNegative'))}>
          <Button
            variant="surface"
            size="icon"
            className={buttonClassName}
            data-e2e="jog-z-negative"
            aria-label={t('jogDirectional.zNegative')}
            disabled={!canJog}
            aria-disabled={!canJog}
            {...getJogButtonProps({ axis: 'z', direction: 'negative' })}
          >
            <ArrowDown className={jogDirectionalIconClassName(size)} />
          </Button>
        </AppTooltip>
      </AppTooltip>
    </div>
  );
}
