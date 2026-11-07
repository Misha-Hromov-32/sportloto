import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClockCounterClockwiseIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { useRef, type ReactNode } from 'react';

import { Button } from '@/components';
import type { EventCounts, OrganizerView } from '@/types/api';

import { EventPreview, FeedPreview } from './EventPreview';
import { problemsByRow, type PreviewRow } from './preview';
import { STEPS, stepHasErrors, validateStep, type EventForm, type FormErrors, type StepKey } from './model';
import {
  AccessFields,
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
import styles from './create.module.css';
import { AudienceFields } from './AudienceFields';
import { QuickWizard } from './QuickWizard';
import { PhotoField } from './PhotoField';
import { CompositionField } from '../event/participation/CompositionField'; // В7

export interface FieldChange {
  label: string;
  from: string;
  to: string;
}

const ROW_STEP: Record<PreviewRow, StepKey> = {
  sport: 'what',
  title: 'what',
  description: 'what',
  when: 'when',
  place: 'when',
  joinMode: 'who',
  capacity: 'who',
  level: 'who',
  discussion: 'who',
  firstStep: 'first',
  price: 'first',
};

export interface WizardProps {
  form: EventForm;
  set: (patch: Partial<EventForm>) => void;
  errors: FormErrors;
  setErrors: (errors: FormErrors) => void;
  step: StepKey;
  setStep: (step: StepKey) => void;
  organizer: OrganizerView;
  edit?: boolean;
  marks?: Record<string, string>;
  counts?: EventCounts;
  /** Правка: что изменится у участников «было → стало». */
  changes?: FieldChange[];
  participants?: number;
  submitting: boolean;
  submitLabel: string;
  onSubmit: () => void;
  top?: ReactNode;
}

/** Ручное заполнение по шагам: на телефоне шаг на экран, на десктопе шаги слева и живая карточка справа. */
function FullWizard({
  form,
  set,
  errors,
  setErrors,
  step,
  setStep,
  organizer,
  edit = false,
  marks,
  counts,
  changes = [],
  participants = 0,
  submitting,
  submitLabel,
  onSubmit,
  top,
}: WizardProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const index = STEPS.findIndex((s) => s.key === step);
  const current = STEPS[index]!;
  const nextStep = STEPS[index + 1];
  const prevStep = STEPS[index - 1];
  const props = { form, set, errors, edit, marks };

  const scrollTop = () => {
    const el = bodyRef.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: 'start' });
  };

  const go = (key: StepKey) => {
    setStep(key);
    requestAnimationFrame(scrollTop);
  };

  const forward = () => {
    const stepErrors = validateStep(step, form, { edit });
    if (Object.keys(stepErrors).length) {
      setErrors({ ...errors, ...stepErrors });
      requestAnimationFrame(() => {
        const first = bodyRef.current?.querySelector<HTMLElement>('[data-field-error]');
        first?.scrollIntoView({ block: 'center' });
        first?.querySelector<HTMLElement>('input, textarea, button')?.focus({ preventScroll: true });
      });
      return;
    }
    if (nextStep) go(nextStep.key);
  };

  const changeNotice =
    edit && changes.length > 0 ? (
      <div className={styles.changeNotice} role="note">
        <ClockCounterClockwiseIcon size={24} aria-hidden />
        <div>
          <p className={styles.changeTitle}>
            {participants > 0
              ? 'Участники увидят, что было и что стало, и подтвердят, что в курсе'
              : 'Записавшихся пока нет, предупреждать некого'}
          </p>
          <ul className={styles.changeList}>
            {changes.map((c) => (
              <li key={c.label}>
                <span className={styles.changeLabel}>{c.label}:</span> было {c.from}, станет {c.to}
              </li>
            ))}
          </ul>
        </div>
      </div>
    ) : null;

  return (
    <div className={styles.wizard}>
      <nav className={styles.stepsNav} aria-label="Шаги">
        <p className={styles.stepsCounter}>
          Шаг {index + 1} из {STEPS.length}
        </p>
        <ol className={styles.stepsList}>
          {STEPS.map((s, i) => {
            const done = i < index;
            const bad = stepHasErrors(s.key, errors);
            return (
              <li key={s.key}>
                <button
                  type="button"
                  className={[
                    styles.stepItem,
                    s.key === step && styles.stepCurrent,
                    done && styles.stepDone,
                    bad && styles.stepBad,
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  aria-current={s.key === step ? 'step' : undefined}
                  aria-label={`Шаг ${i + 1}: ${s.short}${bad ? ', есть ошибки' : ''}`}
                  onClick={() => go(s.key)}
                >
                  <span className={styles.stepMark} aria-hidden>
                    {bad ? (
                      <WarningCircleIcon size={16} weight="bold" />
                    ) : done ? (
                      <CheckIcon size={16} weight="bold" />
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className={styles.stepName}>{s.short}</span>
                  {bad && <span className="sr-only">, есть ошибки</span>}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className={styles.stepBody} ref={bodyRef}>
        {top}
        <h2 className={styles.stepTitle}>{current.title}</h2>

        {step === 'what' && (
          <div className={styles.stepFields} data-motion-key={step}>
            <SportField {...props} />
            <TitleField {...props} />
            <ExtraFields {...props} sport={form.sport} />
            <DescriptionField {...props} />
            <PhotoField {...props} />
          </div>
        )}
        {step === 'when' && (
          <div className={styles.stepFields} data-motion-key={step}>
            {changeNotice}
            <p>
              {form.visibility === 'invite'
                ? 'По приглашению: в общем поиске встреча не появится.'
                : 'Открытая встреча: появится в общем поиске.'}{' '}
              {form.family
                ? form.family.kind === 'kids'
                  ? 'Занятие для детей.'
                  : 'Можно прийти с детьми.'
                : 'Для взрослых.'}{' '}
              {form.againFrom && 'После публикации позовём участников прошлой встречи.'}
            </p>
            <DateTimeFields {...props} />
            <hr className={styles.divider} />
            <PlaceFields {...props} />
          </div>
        )}
        {step === 'who' && (
          <div className={styles.stepFields} data-motion-key={step}>
            <AudienceFields {...props} />
            <JoinModeField {...props} />
            <CapacityFields {...props} />
            <hr className={styles.divider} />
            <LevelFields {...props} />
            <CompositionField {...props} />
            <hr className={styles.divider} />
            <AccessFields {...props} />
          </div>
        )}
        {step === 'first' && (
          <div className={styles.stepFields} data-motion-key={step}>
            <FirstStepFields {...props} />
            <hr className={styles.divider} />
            <PriceFields {...props} />
          </div>
        )}
        {step === 'review' && (
          <div className={styles.stepFields} data-motion-key={step}>
            {changeNotice}
            <p>
              {form.visibility === 'invite'
                ? 'По приглашению: в общем поиске встреча не появится.'
                : 'Открытая встреча: появится в общем поиске.'}{' '}
              {form.family
                ? form.family.kind === 'kids'
                  ? 'Занятие для детей.'
                  : 'Можно прийти с детьми.'
                : 'Для взрослых.'}{' '}
              {form.againFrom && 'После публикации позовём участников прошлой встречи.'}
            </p>
            <div className={styles.reviewFeed}>
              <p className={styles.reviewCaption}>В поиске</p>
              <FeedPreview form={form} organizer={organizer} />
            </div>
            <div>
              <p className={styles.reviewCaption}>Карточка события</p>
              <EventPreview
                form={form}
                organizer={organizer}
                counts={counts}
                onEdit={(row) => go(ROW_STEP[row])}
                problems={problemsByRow(errors)}
              />
            </div>
          </div>
        )}

        <div className={styles.stepActions}>
          {prevStep ? (
            <Button
              variant="secondary"
              icon={<ArrowLeftIcon size={20} aria-hidden />}
              onClick={() => go(prevStep.key)}
            >
              Назад
            </Button>
          ) : (
            <span />
          )}
          {nextStep ? (
            <Button variant="primary" iconAfter={<ArrowRightIcon size={20} aria-hidden />} onClick={forward}>
              {nextStep.key === 'review' ? 'Проверить' : `Дальше: ${nextStep.short.toLowerCase()}`}
            </Button>
          ) : (
            <Button variant="primary" onClick={onSubmit} loading={submitting} loadingText="Сохраняем…">
              {submitLabel}
            </Button>
          )}
        </div>
      </div>

      {step !== 'review' && (
        <aside className={styles.liveAside} aria-label="Предпросмотр карточки">
          <p className={styles.reviewCaption}>Так встречу увидят в поиске</p>
          <FeedPreview form={form} organizer={organizer} />
          <p className={styles.asideHint}>Карточка обновляется, пока вы заполняете шаги.</p>
        </aside>
      )}
    </div>
  );
}

export function Wizard(props: WizardProps) {
  return props.edit ? <FullWizard {...props} /> : <QuickWizard {...props} />;
}
