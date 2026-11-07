import { InputNumber } from 'antd';
import { FieldGroup, OptionCards } from './fields';
import type { SectionProps } from './sections';

export function AudienceFields({ form, set, errors }: SectionProps) {
  const family = form.family;
  return (
    <>
      <FieldGroup
        legend="Кто увидит встречу"
        hint="Закрытую встречу можно открыть только по действующему приглашению."
      >
        <OptionCards
          label="Видимость встречи"
          columns={2}
          value={form.visibility}
          onChange={(visibility) => set({ visibility })}
          options={[
            { value: 'public', title: 'Все желающие', text: 'Появится в поиске и на странице организатора' },
            {
              value: 'invite',
              title: 'По приглашению',
              text: 'Личная ссылка для друзей, команды или коллег',
            },
          ]}
        />
      </FieldGroup>
      <FieldGroup
        legend="Взрослые и дети"
        error={errors.family}
        hint="Каждый ребёнок занимает отдельное место. За ребёнка отвечает записавший его взрослый."
      >
        <OptionCards
          label="Семейный формат"
          columns={3}
          value={family?.kind ?? 'none'}
          onChange={(kind) =>
            set({
              family:
                kind === 'none'
                  ? null
                  : { kind, minAge: kind === 'kids' ? 6 : null, maxAge: kind === 'kids' ? 12 : null },
            })
          }
          options={[
            { value: 'none', title: 'Для взрослых' },
            { value: 'family', title: 'Можно с детьми', text: 'Взрослый тоже участвует' },
            { value: 'kids', title: 'Для детей', text: 'Взрослый сопровождает' },
          ]}
        />
        {family && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
            <label>
              Возраст от
              <br />
              <InputNumber
                aria-label="Минимальный возраст ребёнка"
                min={0}
                max={17}
                value={family.minAge}
                placeholder="Любой"
                onChange={(minAge) => set({ family: { ...family, minAge } })}
              />
            </label>
            <label>
              Возраст до
              <br />
              <InputNumber
                aria-label="Максимальный возраст ребёнка"
                min={0}
                max={17}
                value={family.maxAge}
                placeholder="Любой"
                onChange={(maxAge) => set({ family: { ...family, maxAge } })}
              />
            </label>
          </div>
        )}
      </FieldGroup>
    </>
  );
}
