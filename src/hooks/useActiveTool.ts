import { useAppStore } from '@/store';
import type { LinuxCncToolStatus } from '@/store/types';
import type { Tool } from '@/types/tools';

export interface ActiveToolResult {
  activeTool: Tool | undefined;
  toolNumber: number | undefined;
  rawToolStatus: LinuxCncToolStatus | undefined;
}

function parseToolNumberFromId(id: string | undefined): number | undefined {
  if (!id) return undefined;
  const match = id.match(/^T(\d+)$/i);
  if (!match) return undefined;
  const num = Number.parseInt(match[1], 10);
  return Number.isNaN(num) ? undefined : num;
}

export function useActiveTool(tools?: Tool[]): ActiveToolResult {
  const toolStatus = useAppStore((state) => state.linuxCncStatus.tools);

  const toolNumber = toolStatus?.tool_in_spindle;

  if (!tools || toolNumber == null) {
    return {
      activeTool: undefined,
      toolNumber,
      rawToolStatus: toolStatus,
    };
  }

  const activeTool =
    tools.find((t) => t.toolNumber === toolNumber) ??
    tools.find((t) => parseToolNumberFromId(t.id) === toolNumber);

  return {
    activeTool,
    toolNumber,
    rawToolStatus: toolStatus,
  };
}

