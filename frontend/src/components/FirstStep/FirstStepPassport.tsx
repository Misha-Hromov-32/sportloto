import {
  Backpack,
  Barbell,
  Compass,
  Gauge,
  HandWaving,
  Smiley,
  UsersThree,
  Wrench,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { EVENT_LEVEL, EVENT_LEVEL_HINT, INTENSITY } from '@/lib/labels';
import type { EventLevel, ExtraField, FirstStep, Intensity } from '@/types/domain';

import styles from './FirstStepPassport.module.css';

interface FirstStepPassportProps {
  level: EventLevel;
  beginnersWelcome: boolean;
  firstStep: FirstStep;
  /** Дополнительные поля направления (например, «Контроль времени») и их значения. */
  fields?: ExtraField[];
  extra?: Record<string, string>;
  /** Отметить поля, заполненные помощником. */
  assistantFields?: string[];
}

function IntensityScale({ value }: { value: Intensity }) {
  const level = { low: 1, medium: 2, high: 3 }[value];
  return (
    <span className={styles.scale} aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={i <= level ? styles.scaleOn : styles.scaleOff} />
      ))}
    </span>
  );
}

/** Паспорт «Первый шаг»: подойду ли я, что взять, как найти. Отвечает на вопросы до записи. */
export function FirstStepPassport({
  level,
  beginnersWelcome,
  firstStep,
  fields = [],
  extra = {},
  assistantFields = [],
}: FirstStepPassportProps) {
  const rows: { key: string; icon: ReactNode; label: string; value: ReactNode; hint?: string }[] = [
    {
      key: 'level',
      icon: <Barbell size={22} aria-hidden />,
      label: 'Уровень',
      value: EVENT_LEVEL[level],
      hint: EVENT_LEVEL_HINT[level],
    },
    {
      key: 'intensity',
      icon: <Gauge size={22} aria-hidden />,
      label: 'Нагрузка',
      value: (
        <span className={styles.inline}>
          <IntensityScale value={firstStep.intensity} />
          {INTENSITY[firstStep.intensity].label}
        </span>
      ),
      hint: INTENSITY[firstStep.intensity].hint,
    },
  ];
  if (firstStep.bring)
    rows.push({
      key: 'bring',
      icon: <Backpack size={22} aria-hidden />,
      label: 'Что взять',
      value: firstStep.bring,
    });
  if (firstStep.preparation)
    rows.push({
      key: 'preparation',
      icon: <Wrench size={22} aria-hidden />,
      label: 'Подготовка',
      value: firstStep.preparation,
    });
  if (firstStep.age)
    rows.push({
      key: 'age',
      icon: <UsersThree size={22} aria-hidden />,
      label: 'Возраст',
      value: firstStep.age,
    });
  if (firstStep.howToFind)
    rows.push({
      key: 'howToFind',
      icon: <Compass size={22} aria-hidden />,
      label: 'Как найти',
      value: firstStep.howToFind,
    });
  if (firstStep.amenities.length) {
    rows.push({
      key: 'amenities',
      icon: <Smiley size={22} aria-hidden />,
      label: 'На месте',
      value: firstStep.amenities.join(', '),
    });
  }
  for (const f of fields) {
    if (extra[f.key])
      rows.push({
        key: `extra.${f.key}`,
        icon: <Compass size={22} aria-hidden />,
        label: f.label,
        value: extra[f.key],
      });
  }

  return (
    <section className={styles.root} aria-labelledby="first-step-title">
      <h2 id="first-step-title" className={styles.title}>
        Первый шаг
      </h2>
      {(beginnersWelcome || firstStep.firstTimeNote) && (
        <div className={styles.welcome}>
          <HandWaving size={24} weight="fill" aria-hidden />
          <div>
            {beginnersWelcome && <p className={styles.welcomeTitle}>Рады новичкам</p>}
            {firstStep.firstTimeNote && <p>{firstStep.firstTimeNote}</p>}
          </div>
        </div>
      )}
      <dl className={styles.list}>
        {rows.map((r) => (
          <div key={r.key} className={styles.item}>
            <dt className={styles.label}>
              {r.icon}
              {r.label}
              {assistantFields.includes(r.key) && (
                <span className={styles.byAssistant}>заполнил помощник</span>
              )}
            </dt>
            <dd className={styles.value}>
              {r.value}
              {r.hint && <span className={styles.hint}>{r.hint}</span>}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
