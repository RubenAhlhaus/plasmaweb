import { useEffect, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useAppStore } from '@/store';
import { InterpState, TaskMode } from '@/store/types';
import { programLinesToEditorLineIndex } from '@/lib/programLineToEditorIndex';

/**
 * While a program runs in AUTO (interpreter reading/waiting/paused), sets
 * `programEditor.currentLineIndex` from status `motion_line` / `current_line`.
 * Clears the highlight when the interpreter returns to IDLE after having been active,
 * when leaving MODE_AUTO after a live-driven highlight, or when switching away from AUTO
 * mid-run — without clearing a “run from line” selection that was only set while IDLE in AUTO.
 */
export function useLiveProgramLineHighlight(): void {
  const setProgramEditor = useAppStore((s) => s.setProgramEditor);
  const prevInterpWasActiveRef = useRef(false);

  const { taskMode, interpState, motionLine, currentLine } = useAppStore(
    useShallow((s) => ({
      taskMode: s.linuxCncStatus.machine?.task_mode,
      interpState: s.linuxCncStatus.program?.interp_state,
      motionLine: s.linuxCncStatus.program?.motion_line,
      currentLine: s.linuxCncStatus.program?.current_line,
    })),
  );

  useEffect(() => {
    if (taskMode !== TaskMode.MODE_AUTO) {
      if (prevInterpWasActiveRef.current) {
        setProgramEditor({ currentLineIndex: null });
      }
      prevInterpWasActiveRef.current = false;
      return;
    }

    if (interpState === undefined) {
      return;
    }

    const interpActive =
      interpState === InterpState.INTERP_READING ||
      interpState === InterpState.INTERP_WAITING ||
      interpState === InterpState.INTERP_PAUSED;

    if (interpActive) {
      const idx = programLinesToEditorLineIndex(motionLine, currentLine);
      if (idx !== null) {
        setProgramEditor({ currentLineIndex: idx });
      }
      prevInterpWasActiveRef.current = true;
      return;
    }

    if (interpState === InterpState.INTERP_IDLE && prevInterpWasActiveRef.current) {
      setProgramEditor({ currentLineIndex: null });
    }
    prevInterpWasActiveRef.current = false;
  }, [taskMode, interpState, motionLine, currentLine, setProgramEditor]);
}
