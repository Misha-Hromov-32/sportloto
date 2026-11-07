import { CaretDownIcon, MagnifyingGlassIcon, PlusIcon, SparkleIcon } from '@phosphor-icons/react';
import { useCustom } from '@refinedev/core';
import { Input } from 'antd';
import { useEffect, useId, useMemo, useState } from 'react';

import { Button, Chip, SkeletonBlock, SportIcon } from '@/components';
import { API } from '@/lib/api';
import type { CategoryView, SportSuggestion, SportView } from '@/types/api';

import { useSportsCatalog } from './useSportsCatalog';

import { FieldError } from './fields';
import styles from './SportPicker.module.css';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

interface SportPickerProps {
  value: SportView | null;
  newName: string;
  query: string;
  onQueryChange: (query: string) => void;
  onSelect: (sport: SportView) => void;
  onCreate: (name: string) => void;
  onClear: () => void;
  error?: string;
  /** Направление уже выбрано и меняться не может (правка события). */
  locked?: string;
  label?: string;
}

/**
 * Выбор направления: поиск по каталогу с синонимами и опечатками, популярные сверху, дерево категорий.
 * Своё направление добавляется без дублей: на похожее название сначала спрашиваем «вы имели в виду…».
 */
export function SportPicker({
  value,
  newName,
  query,
  onQueryChange,
  onSelect,
  onCreate,
  onClear,
  error,
  locked,
  label = 'Направление',
}: SportPickerProps) {
  const inputId = useId();
  const { sports, categories, isLoading, isError, refetch } = useSportsCatalog();
  const q = query.trim();
  const debounced = useDebounced(q, 250);
  const suggest = useCustom<SportSuggestion[]>({
    url: API.suggestSports,
    method: 'get',
    config: { query: { q: debounced } },
    queryOptions: { enabled: debounced.length > 0 },
  });
  const [confirmName, setConfirmName] = useState<string | null>(null);

  const suggestions = useMemo(() => {
    const data: unknown = suggest.result.data;
    return debounced.length > 0 && Array.isArray(data) ? (data as SportSuggestion[]) : [];
  }, [debounced, suggest.result.data]);
  const searching = q.length > 0 && (q !== debounced || suggest.query.isFetching);
  const exact = suggestions.find((s) => s.match === 'exact' || s.match === 'synonym');
  const similar = suggestions.filter((s) => s.match === 'prefix' || s.match === 'typo');

  if (value || newName) {
    const sport = value ?? { name: newName, icon: null };
    const categoryNames = value
      ? categories.filter((c) => value.categoryIds.includes(c.id)).map((c) => c.name)
      : [];
    return (
      <div className={styles.root}>
        <span className={styles.label}>{label}</span>
        <div className={styles.selected}>
          <SportIcon sport={sport} size={28} variant="framed" />
          <div className={styles.selectedText}>
            <span className={styles.selectedName}>{sport.name}</span>
            <span className={styles.selectedHint}>
              {locked
                ? locked
                : value
                  ? value.kind === 'custom'
                    ? 'Направление добавили участники'
                    : categoryNames.join(', ') || 'Из каталога'
                  : 'Новое направление. Появится в поиске сразу после публикации'}
            </span>
          </div>
          {!locked && (
            <Button
              variant="quiet"
              size="sm"
              onClick={() => {
                setConfirmName(null);
                onClear();
              }}
            >
              Выбрать другое
            </Button>
          )}
        </div>
        <FieldError error={error} />
      </div>
    );
  }

  const create = () => {
    if (similar.length > 0 && !exact) setConfirmName(q);
    else onCreate(q);
  };

  return (
    <div className={styles.root} data-field-error={error ? true : undefined}>
      <label className={styles.label} htmlFor={inputId}>
        {label}
      </label>
      <p className={styles.hint}>
        Начните писать: «теннис», «скандинавская ходьба», «городки». Нет в списке? Добавьте своё.
      </p>
      <Input
        id={inputId}
        size="large"
        value={query}
        onChange={(e) => {
          setConfirmName(null);
          onQueryChange(e.target.value);
        }}
        placeholder="Найти направление"
        prefix={<MagnifyingGlassIcon size={20} aria-hidden />}
        allowClear
        autoComplete="off"
        status={error ? 'error' : undefined}
        aria-describedby={error ? `${inputId}-error` : undefined}
      />
      <span id={`${inputId}-error`}>
        <FieldError error={error} />
      </span>

      {q.length > 0 ? (
        <div className={styles.results} aria-live="polite">
          {searching && suggestions.length === 0 ? (
            <p className={styles.muted}>Ищем в каталоге…</p>
          ) : suggestions.length > 0 ? (
            <>
              <p className={styles.groupTitle}>
                {exact ? (
                  'Нашлось в каталоге'
                ) : (
                  <>
                    <SparkleIcon size={16} weight="fill" aria-hidden />
                    Возможно, вы имели в виду
                  </>
                )}
              </p>
              <ul className={styles.resultList}>
                {suggestions.map((s) => (
                  <li key={s.id}>
                    <button type="button" className={styles.result} onClick={() => onSelect(s)}>
                      <SportIcon sport={s} size={22} variant="framed" />
                      <span className={styles.resultText}>
                        <span className={styles.resultName}>{s.name}</span>
                        {s.match === 'synonym' && (
                          <span className={styles.resultHint}>
                            Так ещё называют: {query.trim().toLowerCase()}
                          </span>
                        )}
                        {s.kind === 'custom' && <span className={styles.resultHint}>Добавили участники</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className={styles.muted}>В каталоге такого нет. Можно добавить своё направление.</p>
          )}

          {!exact &&
            !searching &&
            q.length >= 2 &&
            (confirmName ? (
              <div className={styles.confirm} role="group" aria-label="Проверка похожего направления">
                <p className={styles.confirmTitle}>Возможно, вы имели в виду «{similar[0]!.name}»?</p>
                <p className={styles.hint}>
                  Проверьте, есть ли этот вид спорта под другим названием. Выберите его из каталога, чтобы
                  участники могли найти вашу встречу.
                </p>
                <div className={styles.confirmActions}>
                  <Button variant="secondary" onClick={() => onSelect(similar[0]!)}>
                    Да, это оно
                  </Button>
                  <Button variant="quiet" onClick={() => onCreate(confirmName)}>
                    Нет, создать «{confirmName}»
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="secondary"
                icon={<PlusIcon size={20} aria-hidden />}
                onClick={create}
                className={styles.add}
              >
                Добавить «{q}» как новое направление
              </Button>
            ))}
        </div>
      ) : isError ? (
        <div className={styles.results}>
          <p className={styles.muted}>
            Не удалось загрузить каталог. Можно вписать направление вручную в поле выше.
          </p>
          <Button variant="quiet" size="sm" onClick={refetch}>
            Загрузить ещё раз
          </Button>
        </div>
      ) : isLoading ? (
        <div className={styles.results} aria-hidden>
          <div className={styles.chipRow}>
            {[96, 120, 88, 140, 104].map((w) => (
              <SkeletonBlock key={w} width={w} height={44} radius="pill" />
            ))}
          </div>
        </div>
      ) : (
        <Catalog sports={sports} categories={categories} onSelect={onSelect} />
      )}
    </div>
  );
}

function Catalog({
  sports,
  categories,
  onSelect,
}: {
  sports: SportView[];
  categories: CategoryView[];
  onSelect: (sport: SportView) => void;
}) {
  const popular = sports.filter((s) => s.popular);
  const custom = sports.filter((s) => s.kind === 'custom');
  const roots = categories.filter((c) => c.parentId === null);
  return (
    <div className={styles.results}>
      <p className={styles.groupTitle}>Популярные</p>
      <div className={styles.chipRow}>
        {popular.map((s) => (
          <Chip key={s.id} icon={<SportIcon sport={s} size={18} />} onClick={() => onSelect(s)}>
            {s.name}
          </Chip>
        ))}
      </div>
      <p className={styles.groupTitle}>Все направления</p>
      <div className={styles.tree}>
        {roots.map((c) => {
          const children = categories.filter((x) => x.parentId === c.id);
          const own = c.sports.filter((s) => !children.some((ch) => ch.sports.some((x) => x.id === s.id)));
          return (
            <details key={c.id} className={styles.category}>
              <summary className={styles.summary}>
                <span>{c.name}</span>
                <span className={styles.count}>{c.sports.length}</span>
                <CaretDownIcon size={18} aria-hidden className={styles.caret} />
              </summary>
              <div className={styles.categoryBody}>
                {children.map((ch) => (
                  <div key={ch.id} className={styles.sub}>
                    <span className={styles.subTitle}>{ch.name}</span>
                    <div className={styles.chipRow}>
                      {ch.sports.map((s) => (
                        <Chip key={s.id} icon={<SportIcon sport={s} size={18} />} onClick={() => onSelect(s)}>
                          {s.name}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
                {own.length > 0 && (
                  <div className={styles.chipRow}>
                    {own.map((s) => (
                      <Chip key={s.id} icon={<SportIcon sport={s} size={18} />} onClick={() => onSelect(s)}>
                        {s.name}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            </details>
          );
        })}
        {custom.length > 0 && (
          <details className={styles.category}>
            <summary className={styles.summary}>
              <span>Добавили участники</span>
              <span className={styles.count}>{custom.length}</span>
              <CaretDownIcon size={18} aria-hidden className={styles.caret} />
            </summary>
            <div className={styles.categoryBody}>
              <div className={styles.chipRow}>
                {custom.map((s) => (
                  <Chip key={s.id} icon={<SportIcon sport={s} size={18} />} onClick={() => onSelect(s)}>
                    {s.name}
                  </Chip>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
