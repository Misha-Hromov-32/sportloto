import { COMPOSITION } from '@/lib/labels';
import type { Composition } from '@/types/domain';

import { FieldGroup, OptionCards } from '../../create/fields';
import type { SectionProps } from '../../create/sections';

const ORDER: Composition[] = ['mixed', 'women', 'men'];

const TEXT: Record<Composition, string> = {
  mixed: 'Записаться может любой',
  women: 'Записаться смогут только женщины',
  men: 'Записаться смогут только мужчины',
};

/** В7: поле «Состав» на шаге «Кто и как» при создании и изменении события. */
export function CompositionField({ form, set }: SectionProps) {
  return (
    <FieldGroup
      legend="Состав"
      hint="Записаться на встречу только для женщин или только для мужчин смогут те, кто указал пол в профиле. Остальные увидят в карточке, почему записаться нельзя."
    >
      <OptionCards
        label="Состав"
        columns={1}
        size="sm"
        value={form.composition ?? 'mixed'}
        onChange={(composition) => set({ composition })}
        options={ORDER.map((c) => ({ value: c, title: COMPOSITION[c].label, text: TEXT[c] }))}
      />
    </FieldGroup>
  );
}
