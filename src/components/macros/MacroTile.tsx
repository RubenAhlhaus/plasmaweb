import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useMacroDefinitionLabels } from '@/lib/macroDefinitionLabels';
import type { MacroDefinition } from '@/types/macros';
import { cn } from '@/lib/utils';

type MacroTileProps = {
  definition: MacroDefinition;
  onClick: () => void;
  className?: string;
};

export function MacroTile({ definition, onClick, className }: MacroTileProps) {
  const { title, subtitle } = useMacroDefinitionLabels(definition);
  return (
    <Card
      className={cn(
        'cursor-pointer transition-colors hover:bg-white/20 border-border/50',
        className
      )}
      onClick={onClick}
      data-e2e={`macros-tile-${definition.id}`}
    >
      <CardHeader className="p-4">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle ? (
          <CardDescription className="text-sm mt-0.5">{subtitle}</CardDescription>
        ) : null}
      </CardHeader>
    </Card>
  );
}
