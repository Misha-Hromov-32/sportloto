import { FlagIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { Input, Select } from 'antd';
import { useId } from 'react';

import { AssistantMark } from '@/components';
import { READINESS, SKILL_LEVEL } from '@/lib/labels';
import { capitalize } from '@/lib/text';
import { districtsOf } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { District, SkillLevel } from '@/types/domain';

import { ChoiceChips, Field, FieldGroup, OptionCards } from '../../events/create/fields';
import { SportPicker } from '../../events/create/SportPicker';
import { WHEN_OPTIONS, type CompanionErrors, type CompanionForm } from './model';
import styles from './companions.module.css';

export type CompanionMarkKey = 'sport' | 'text' | 'district' | 'when' | 'level' | 'readiness';

interface Props {
  form: CompanionForm;
  set: (patch: Partial<CompanionForm>) => void;
  errors: CompanionErrors;
  marks?: Partial<Record<CompanionMarkKey, string>>;
}

const LEVELS: SkillLevel[] = ['beginner', 'amateur', 'experienced'];
const LEVEL_TEXT: Record<SkillLevel, string> = {
  beginner: 'Только начинаю или давно не занимался',
  amateur: 'Знаю правила, занимаюсь для себя',
  experienced: 'Занимаюсь давно и в хорошем темпе',
};

/** Поля объявления «Ищу компанию»: что, где, когда, уровень и готовность. */
export function CompanionFields({ form, set, errors, marks = {} }: Props) {
  const textId = useId();
  const districtId = useId();
  const whenId = useId();
  const districts = useList<District>({ resource: 'districts', pagination: { mode: 'off' } });
  const city = useSelectedCity();
  const mark = (key: CompanionMarkKey) =>
    marks[key] !== undefined ? <AssistantMark why={marks[key]} /> : null;

  return (
    <div className={styles.fields}>
      <div className={styles.pickerWrap}>
        <SportPicker
          label="Чем хотите заниматься"
          value={form.sport}
          newName={form.newSportName}
          query={form.sportQuery}
          onQueryChange={(sportQuery) => set({ sportQuery })}
          onSelect={(sport) => set({ sport, newSportName: '', sportQuery: '' })}
          onCreate={(name) => set({ sport: null, newSportName: capitalize(name.trim()), sportQuery: '' })}
          onClear={() => set({ sport: null, newSportName: '', sportQuery: '' })}
          error={errors.sport}
        />
        {mark('sport')}
      </div>

      <Field
        label="Кого ищете"
        htmlFor={textId}
        hint="Пара фраз о себе и о том, с кем хотите заниматься."
        error={errors.text}
        mark={mark('text')}
      >
        <Input.TextArea
          id={textId}
          value={form.text}
          onChange={(e) => set({ text: e.target.value })}
          autoSize={{ minRows: 3, maxRows: 8 }}
          maxLength={500}
          showCount
          placeholder="Хочу бегать по утрам, ищу компанию примерно моего темпа. Бегаю 5 км за 35 минут."
          status={errors.text ? 'error' : undefined}
        />
      </Field>

      <Field
        label="Район"
        htmlFor={districtId}
        optional
        hint="По району вас найдут те, кто живёт рядом."
        mark={mark('district')}
      >
        <Select
          id={districtId}
          size="large"
          value={form.districtId ?? undefined}
          onChange={(v: string | undefined) => set({ districtId: v ?? null })}
          allowClear
          placeholder="Выберите район"
          loading={districts.query.isLoading}
          options={districtsOf(districts.result.data, city, form.districtId).map((d) => ({
            value: d.id,
            label: d.name,
          }))}
        />
      </Field>

      <Field label="Когда вам удобно" htmlFor={whenId} error={errors.when} mark={mark('when')}>
        <ChoiceChips
          label="Быстрый выбор времени"
          value={WHEN_OPTIONS.includes(form.when) ? form.when : null}
          options={WHEN_OPTIONS.map((w) => ({ value: w, label: w }))}
          onChange={(when) => set({ when })}
        />
        <Input
          id={whenId}
          size="large"
          value={form.when}
          onChange={(e) => set({ when: e.target.value })}
          maxLength={80}
          placeholder="Или своими словами: вторник и четверг после 19:00"
          status={errors.when ? 'error' : undefined}
        />
      </Field>

      <FieldGroup legend="Ваш уровень" mark={mark('level')}>
        <OptionCards
          label="Ваш уровень"
          columns={3}
          size="sm"
          value={form.level}
          onChange={(level) => set({ level })}
          options={LEVELS.map((l) => ({ value: l, title: SKILL_LEVEL[l], text: LEVEL_TEXT[l] }))}
        />
      </FieldGroup>

      <FieldGroup legend="Что вы готовы сделать" mark={mark('readiness')}>
        <OptionCards
          label="Что вы готовы сделать"
          columns={2}
          size="sm"
          value={form.readiness}
          onChange={(readiness) => set({ readiness })}
          options={[
            {
              value: 'join',
              title: READINESS.join.label,
              text: 'Ищете, к кому пойти. Организаторы смогут позвать вас на свои события',
              icon: <MagnifyingGlassIcon size={20} aria-hidden />,
            },
            {
              value: 'organize',
              title: READINESS.organize.label,
              text: 'Когда наберутся люди, вы соберёте из объявления встречу одной кнопкой',
              icon: <FlagIcon size={20} aria-hidden />,
            },
          ]}
        />
      </FieldGroup>
    </div>
  );
}
