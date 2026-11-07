import { PlusIcon } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { Input, Select } from 'antd';
import { useEffect, useId, useMemo, useState } from 'react';

import { Button, Chip, SportIcon } from '@/components';
import { normalize } from '@/lib/text';
import type { SportSuggestion, SportView } from '@/types/api';

import styles from './FormParts.module.css';

interface SportsPickerProps {
  catalog: SportView[];
  sportIds: string[];
  customSports: string[];
  onChange: (next: { sportIds: string[]; customSports: string[] }) => void;
  invalid?: boolean;
  describedBy?: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

const MATCH_TEXT: Record<SportSuggestion['match'], string> = {
  exact: 'уже есть в каталоге',
  synonym: 'так его тоже называют',
  prefix: 'похожее название',
  typo: 'возможно, опечатка',
};

/** Направления из каталога и своё, если его нет: новое создаётся при отправке и не дублирует существующие. */
export function SportsPicker({
  catalog,
  sportIds,
  customSports,
  onChange,
  invalid,
  describedBy,
}: SportsPickerProps) {
  const ownId = useId();
  const [ownOpen, setOwnOpen] = useState(customSports.length > 0);
  const [own, setOwn] = useState('');
  const query = useDebounced(own.trim(), 300);

  const { result } = useList<SportSuggestion>({
    resource: 'sports',
    filters: [{ field: 'q', operator: 'eq', value: query }],
    pagination: { mode: 'off' },
    queryOptions: { enabled: query.length >= 2 },
  });
  const suggestions = query.length >= 2 ? (result.data ?? []).slice(0, 3) : [];

  const byId = useMemo(() => new Map(catalog.map((s) => [s.id, s])), [catalog]);
  const popular = catalog.filter((s) => s.popular).slice(0, 10);
  const popularIds = new Set(popular.map((s) => s.id));
  const extra = sportIds.filter((id) => !popularIds.has(id));

  const toggle = (id: string) =>
    onChange({
      sportIds: sportIds.includes(id) ? sportIds.filter((x) => x !== id) : [...sportIds, id],
      customSports,
    });
  const add = (id: string) => {
    if (!sportIds.includes(id)) onChange({ sportIds: [...sportIds, id], customSports });
    setOwn('');
  };
  const addCustom = () => {
    const name = own.trim().replace(/\s+/g, ' ');
    if (name.length < 2) return;
    const exact = suggestions.find((s) => s.match === 'exact' || s.match === 'synonym');
    if (exact) return add(exact.id);
    if (!customSports.some((c) => normalize(c) === normalize(name)))
      onChange({ sportIds, customSports: [...customSports, name] });
    setOwn('');
  };

  const options = catalog
    .filter((s) => !sportIds.includes(s.id))
    .map((s) => ({ value: s.id, label: s.name, search: normalize([s.name, ...s.synonyms].join(' ')) }));

  return (
    <div className={styles.sports} aria-describedby={describedBy}>
      <div className={styles.chips} role="group" aria-labelledby="org-sportIds-label">
        {popular.map((s) => (
          <Chip
            key={s.id}
            selected={sportIds.includes(s.id)}
            onClick={() => toggle(s.id)}
            icon={<SportIcon sport={s} size={18} />}
          >
            {s.name}
          </Chip>
        ))}
        {extra.map((id) => {
          const s = byId.get(id);
          return (
            <Chip
              key={id}
              onRemove={() => toggle(id)}
              icon={s ? <SportIcon sport={s} size={18} /> : undefined}
            >
              {s?.name ?? 'Направление'}
            </Chip>
          );
        })}
        {customSports.map((name) => (
          <Chip
            key={`custom-${name}`}
            onRemove={() => onChange({ sportIds, customSports: customSports.filter((c) => c !== name) })}
            icon={<SportIcon sport={{ name, icon: null }} size={18} />}
          >
            {name}
          </Chip>
        ))}
      </div>

      <div className={styles.subfield}>
        <label htmlFor="org-sportIds" className={styles.sublabel}>
          Другие направления из каталога
        </label>
        <Select
          id="org-sportIds"
          showSearch
          value={null}
          placeholder="Начните писать: бадминтон, городки, плавание"
          options={options}
          optionFilterProp="search"
          filterOption={(input, option) => Boolean(option?.search.includes(normalize(input)))}
          onChange={(id: string | null) => id && add(id)}
          status={invalid ? 'error' : undefined}
          notFoundContent="Такого нет в каталоге. Добавьте своё направление ниже"
          className={styles.select}
        />
      </div>

      {!ownOpen ? (
        <Button
          variant="quiet"
          size="sm"
          icon={<PlusIcon size={18} aria-hidden />}
          onClick={() => setOwnOpen(true)}
          className={styles.alignStart}
        >
          Нет нужного направления
        </Button>
      ) : (
        <div className={styles.subfield}>
          <label htmlFor={ownId} className={styles.sublabel}>
            Своё направление
          </label>
          <div className={styles.inline}>
            <Input
              id={ownId}
              value={own}
              onChange={(e) => setOwn(e.target.value)}
              onPressEnter={(e) => {
                e.preventDefault();
                addCustom();
              }}
              placeholder="Например, лапта"
              maxLength={40}
            />
            <Button variant="secondary" onClick={addCustom} disabled={own.trim().length < 2}>
              Добавить
            </Button>
          </div>
          {suggestions.length > 0 && (
            <div className={styles.suggest} aria-live="polite">
              <p className={styles.suggestTitle}>Возможно, вы имели в виду:</p>
              <ul className={styles.suggestList}>
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button type="button" className={styles.suggestItem} onClick={() => add(s.id)}>
                      <SportIcon sport={s} size={18} />
                      <span className={styles.suggestName}>{s.name}</span>
                      <span className={styles.suggestWhy}>{MATCH_TEXT[s.match]}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className={styles.hint}>
            Своё направление добавится в каталог, когда вы отправите заявку. По нему сразу можно будет искать.
          </p>
        </div>
      )}
    </div>
  );
}
