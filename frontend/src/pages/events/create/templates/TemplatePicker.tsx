import { CheckCircleIcon } from '@phosphor-icons/react';
import { useId, useState } from 'react';

import { SkeletonBlock, SportIcon } from '@/components';
import { ENGAGEMENT_API, useLiveGet } from '@/lib/api';
import type { SportView } from '@/types/api';
import type { EventTemplate } from '@/types/engagement';

import type { EventForm } from '../model';
import styles from './templates.module.css';

interface TemplatePickerProps {
  sports: SportView[];
  onApply: (patch: Partial<EventForm>) => void;
}

function patchOf(t: EventTemplate, sport: SportView): Partial<EventForm> {
  const f = t.fields;
  return {
    sport,
    newSportName: '',
    confirmNewSport: false,
    sportQuery: '',
    extra: { ...t.extra },
    title: f.title,
    description: f.description,
    durationMin: f.durationMin,
    capacity: f.capacity,
    minParticipants: f.minParticipants,
    level: f.level,
    beginnersWelcome: f.beginnersWelcome,
    joinMode: f.joinMode,
    time: f.time,
    bring: f.bring,
    preparation: f.preparation,
    intensity: f.intensity,
    firstTimeNote: f.firstTimeNote,
  };
}

/** С11: четыре шаблона в начале мастера. Выбор заполняет поля, дату и место человек выбирает сам. */
export function TemplatePicker({ sports, onApply }: TemplatePickerProps) {
  const titleId = useId();
  const { data, isLoading, isError } = useLiveGet<EventTemplate[]>(ENGAGEMENT_API.templates, ['sports']);
  const [applied, setApplied] = useState<EventTemplate | null>(null);

  // Шаблоны — подсказка, а не обязательный шаг: если не загрузились, мастер работает как обычно
  if (isError) return null;
  const templates = (data ?? []).filter((t) => sports.some((s) => s.id === t.sportId));

  return (
    <section className={styles.picker} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.title}>
        Начать с шаблона
      </h2>
      {isLoading || !sports.length ? (
        <div className={styles.grid} aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <SkeletonBlock key={i} height={88} />
          ))}
        </div>
      ) : (
        <div className={styles.grid} role="group" aria-label="Шаблоны встреч">
          {templates.map((t) => {
            const sport = sports.find((s) => s.id === t.sportId)!;
            const on = applied?.id === t.id;
            return (
              <button
                key={t.id}
                type="button"
                className={[styles.card, on && styles.cardOn].filter(Boolean).join(' ')}
                aria-pressed={on}
                onClick={() => {
                  onApply(patchOf(t, sport));
                  setApplied(t);
                }}
              >
                <SportIcon sport={sport} size={24} weight="regular" />
                <span className={styles.cardText}>
                  <span className={styles.cardName}>{t.name}</span>
                  <span className={styles.cardHint}>{t.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      <p className={applied ? styles.done : styles.hint} role="status">
        {applied ? (
          <>
            <CheckCircleIcon size={20} weight="fill" aria-hidden />
            <span>
              Заполнили по шаблону «{applied.name}». Выберите дату и место, остальное можно поменять на любом шаге.
            </span>
          </>
        ) : (
          'Шаблон заполнит название, описание, время и «Первый шаг». Можно и без шаблона: заполните поля ниже.'
        )}
      </p>
    </section>
  );
}
