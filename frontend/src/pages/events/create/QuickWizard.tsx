import { Input, Select } from 'antd';
import { useId, useRef } from 'react';
import { Button } from '@/components';
import { dayjs } from '@/lib/dates';
import { Field } from './fields';
import {
  AccessFields,
  AddressMapField,
  CapacityFields,
  DateTimeFields,
  DescriptionField,
  ExtraFields,
  FirstStepFields,
  JoinModeField,
  LevelFields,
  PlaceFields,
  PriceFields,
  SportField,
  TitleField,
} from './sections';
import { AudienceFields } from './AudienceFields';
import { CompositionField } from '../event/participation/CompositionField';
import { EventPreview, FeedPreview } from './EventPreview';
import { PhotoField } from './PhotoField';
import { firstStepWithError, formTimeCity, stepHasErrors, validateAll } from './model';
import type { WizardProps } from './Wizard';
import styles from './create.module.css';

/** Обязательный путь новой встречи: основное → проверка. Дополнения раскрываются по желанию. */
export function QuickWizard(p: WizardProps) {
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const review = p.step === 'review';
  const { form, set } = p;
  const city = formTimeCity(form);
  const forward = () => {
    const errors = validateAll(form, { edit: false });
    p.setErrors(errors);
    if (Object.keys(errors).length) {
      p.setStep(firstStepWithError(errors) ?? 'what');
      requestAnimationFrame(() => {
        const first = root.current?.querySelector<HTMLElement>('[data-field-error]');
        first?.scrollIntoView({ block: 'center' });
        first?.querySelector<HTMLElement>('input,textarea,button')?.focus({ preventScroll: true });
      });
    } else {
      p.setStep('review');
      root.current?.scrollIntoView({ block: 'start' });
    }
  };
  return (
    <div ref={root}>
      <nav className={styles.quickSteps} aria-label="Шаги создания встречи">
        <button type="button" aria-current={!review ? 'step' : undefined} onClick={() => p.setStep('what')}>
          1. Основное
        </button>
        <button type="button" aria-current={review ? 'step' : undefined} onClick={forward}>
          2. Проверка
        </button>
      </nav>
      <div className={styles.quickLayout}>
        <div className={styles.stepBody}>
          {p.top}
          <h2 className={styles.stepTitle}>{review ? 'Проверьте встречу' : 'Соберёмся на спорт'}</h2>
          {review ? (
            <div className={styles.stepFields} data-motion-key={review ? 'review' : 'form'}>
              <p>
                {form.visibility === 'invite'
                  ? 'По приглашению: скрыта из общего поиска.'
                  : 'Публичная встреча. Условия записи указаны ниже.'}
              </p>
              {form.againFrom && <p>После публикации пригласим участников прошлой встречи.</p>}
              {form.coverUrl && (
                <img
                  className={styles.photoPreview}
                  src={form.coverUrl}
                  alt="Обложка встречи перед публикацией"
                />
              )}
              <EventPreview
                form={form}
                organizer={p.organizer}
                onEdit={(row) =>
                  p.setStep(
                    row === 'joinMode' || row === 'capacity' || row === 'level' || row === 'discussion'
                      ? 'who'
                      : row === 'firstStep' || row === 'price'
                        ? 'first'
                        : 'what',
                  )
                }
              />
            </div>
          ) : (
            <div className={styles.stepFields} data-motion-key={review ? 'review' : 'form'}>
              <p>
                Укажите занятие, время и место. По умолчанию встреча бесплатная, со свободной записью.
                Остальное можно добавить ниже.
              </p>
              <SportField {...p} />
              <TitleField {...p} />
              <div className={styles.quickTime}>
                <Field label="Дата" htmlFor={`${id}-date`} error={p.errors.date}>
                  <Input
                    id={`${id}-date`}
                    size="large"
                    type="date"
                    min={dayjs().format('YYYY-MM-DD')}
                    value={form.date}
                    onChange={(e) => set({ date: e.target.value })}
                  />
                </Field>
                <Field label="Начало" htmlFor={`${id}-time`} error={p.errors.time}>
                  <Input
                    id={`${id}-time`}
                    size="large"
                    type="time"
                    step={300}
                    value={form.time}
                    onChange={(e) => set({ time: e.target.value })}
                  />
                </Field>
                <Field label="Длительность" htmlFor={`${id}-duration`} error={p.errors.durationMin}>
                  <Select
                    id={`${id}-duration`}
                    size="large"
                    value={form.durationMin}
                    onChange={(durationMin) => set({ durationMin })}
                    options={[45, 60, 90, 120, 180, form.durationMin]
                      .filter((v, i, a) => a.indexOf(v) === i)
                      .map((value) => ({ value, label: `${value} минут` }))}
                  />
                </Field>
              </div>
              <p className={styles.asideHint}>Местное время встречи: {city.name}.</p>
              <AddressMapField {...p} />
              <details
                className={styles.optional}
                open={
                  p.step === 'who' || stepHasErrors('who', p.errors) || Boolean(p.errors.price) || undefined
                }
              >
                <summary>Участники, запись и стоимость</summary>
                <div className={styles.stepFields}>
                  <AudienceFields {...p} />
                  <JoinModeField {...p} />
                  <CapacityFields {...p} />
                  <LevelFields {...p} />
                  <CompositionField {...p} />
                  <AccessFields {...p} />
                  <PriceFields {...p} />
                </div>
              </details>
              <details className={styles.optional}>
                <summary>Фото, описание и особенности занятия</summary>
                <div className={styles.stepFields}>
                  <PhotoField {...p} />
                  <DescriptionField {...p} />
                  <ExtraFields {...p} sport={form.sport} />
                </div>
              </details>
              <details
                className={styles.optional}
                open={p.step === 'first' || stepHasErrors('first', p.errors) || undefined}
              >
                <summary>Первый визит и инвентарь</summary>
                <div className={styles.stepFields}>
                  <FirstStepFields {...p} />
                </div>
              </details>
              <details className={styles.optional}>
                <summary>Площадка и как нас найти</summary>
                <div className={styles.stepFields}>
                  <PlaceFields {...p} detailsOnly />
                </div>
              </details>
              <details className={styles.optional} open={Boolean(p.errors.repeatUntil) || undefined}>
                <summary>Повторять встречу и точные настройки времени</summary>
                <div className={styles.stepFields}>
                  <DateTimeFields {...p} />
                </div>
              </details>
            </div>
          )}
          <div className={styles.stepActions}>
            {review ? (
              <>
                <Button variant="secondary" onClick={() => p.setStep('what')}>
                  Изменить
                </Button>
                <Button
                  variant="primary"
                  onClick={p.onSubmit}
                  loading={p.submitting}
                  loadingText="Публикуем…"
                >
                  {p.submitLabel}
                </Button>
              </>
            ) : (
              <Button variant="primary" onClick={forward}>
                Проверить и опубликовать
              </Button>
            )}
          </div>
        </div>
        {!review && (
          <aside className={styles.quickPreview} aria-label="Предпросмотр встречи">
            <p className={styles.reviewCaption}>Так встречу увидят в поиске</p>
            <FeedPreview form={form} organizer={p.organizer} />
          </aside>
        )}
      </div>
    </div>
  );
}
