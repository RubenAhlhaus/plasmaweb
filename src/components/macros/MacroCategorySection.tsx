import { useTranslation } from 'react-i18next';
import { MacroTile } from './MacroTile';
import type { MacroCategoryId, MacroDefinition } from '@/types/macros';

type MacroCategorySectionProps = {
  category: MacroCategoryId;
  definitions: MacroDefinition[];
  onTileClick: (definition: MacroDefinition) => void;
};

export function MacroCategorySection({
  category,
  definitions,
  onTileClick,
}: MacroCategorySectionProps) {
  const { t } = useTranslation('macros');
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider px-1">
        {t(`categories.${category}`)}
      </h3>
      <div className="grid gap-2 grid-cols-1 sm:grid-cols-2">
        {definitions.map((def) => (
          <MacroTile
            key={def.id}
            definition={def}
            onClick={() => onTileClick(def)}
          />
        ))}
      </div>
    </section>
  );
}
