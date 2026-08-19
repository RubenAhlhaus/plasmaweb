import { useMemo } from 'react';
import { useAppStore } from '@/store';
import { mapToolTableToTools } from '@/lib/linuxCncToolTable';

/**
 * Tools from LinuxCNC status (`tool_table`), mapped for the UI.
 * Empty when disconnected or no rows.
 */
export function useToolsFromBackend() {
  const toolTable = useAppStore((s) => s.linuxCncStatus.tools.tool_table);

  const tools = useMemo(() => mapToolTableToTools(toolTable), [toolTable]);

  return { tools };
}
