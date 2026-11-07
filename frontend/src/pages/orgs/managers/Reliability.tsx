import { CheckCircleIcon, SealCheckIcon, SealQuestionIcon, XCircleIcon } from '@phosphor-icons/react';
import { App } from 'antd';

import { Button } from '@/components';
import { ENGAGEMENT_API, useAction } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import { plural } from '@/lib/plural';
import type { EventView, OrganizerFacts } from '@/types/api';
import type { HeldAnswer } from '@/types/engagement';

import styles from './managers.module.css';

const MEETINGS_GEN = ['встречи', 'встреч', 'встреч'] as const;

/** С15: «Подтвердили участники: 5 из 7 встреч». Без проведённых встреч — ничего. */
function reliabilityText(facts: OrganizerFacts): string | null {
  if (facts.confirmed === undefined) return null;
  const disputed = facts.disputed ?? 0;
  if (facts.held === 0 && disputed === 0) return null;
  const main = `Подтвердили участники: ${facts.confirmed} из ${facts.held} ${plural(facts.held, MEETINGS_GEN)}`;
  return disputed ? `${main}. По словам участников, не состоялось: ${disputed}` : main;
}

export function ReliabilityNote({ facts, className }: { facts: OrganizerFacts; className?: string }) {
  const text = reliabilityText(facts);
  if (!text) return null;
  return (
    <span className={[styles.reliability, className].filter(Boolean).join(' ')}>
      <SealCheckIcon size={18} weight="fill" aria-hidden />
      {text}
    </span>
  );
}

const ANSWER_TEXT: Record<HeldAnswer, string> = {
  yes: 'Вы ответили: встреча состоялась',
  no: 'Вы ответили: встреча не состоялась',
};

/**
 * С15: вопрос участнику после встречи. Один ответ на человека, его нельзя поменять,
 * поэтому «Нет» спрашиваем ещё раз.
 */
export function HeldQuestion({ event: e, compact = false }: { event: EventView; compact?: boolean }) {
  const { run, isPending } = useAction();
  const { modal } = App.useApp();
  const check = e.heldCheck;
  if (!check || (!check.canAnswer && !check.answer)) return null;

  const answer = (value: HeldAnswer) =>
    void run(ENGAGEMENT_API.held(e.id), { answer: value }, { method: 'put', success: 'Спасибо, ответ учтён' }).catch(
      () => undefined,
    );
  const sayNo = () =>
    modal.confirm({
      title: 'Встреча не состоялась?',
      content: 'Если большинство участников ответят так же, встреча не попадёт в проведённые у организатора. Изменить ответ потом нельзя.',
      okText: 'Да, не состоялась',
      cancelText: 'Вернуться',
      onOk: () => answer('no'),
    });

  if (check.answer)
    return (
      <p className={[styles.heldDone, compact && styles.heldCompact].filter(Boolean).join(' ')} id={compact ? undefined : 'held'}>
        {check.answer === 'yes' ? (
          <CheckCircleIcon size={20} weight="fill" aria-hidden />
        ) : (
          <XCircleIcon size={20} weight="fill" aria-hidden />
        )}
        {ANSWER_TEXT[check.answer]}
      </p>
    );

  return (
    <section
      className={[styles.held, compact && styles.heldCompact].filter(Boolean).join(' ')}
      id={compact ? undefined : 'held'}
      aria-label="Встреча состоялась?"
    >
      <p className={styles.heldTitle}>
        <SealQuestionIcon size={22} weight="fill" aria-hidden />
        Встреча состоялась?
      </p>
      {!compact && (
        <p className={styles.muted}>
          Ваш ответ не покажут по имени, он попадёт в общий счёт у организатора. Ответить можно до{' '}
          {dayjs(check.until).format('D MMMM')}.
        </p>
      )}
      <div className={styles.heldActions}>
        <Button size="sm" variant="primary" loading={isPending} loadingText="Отправляем…" onClick={() => answer('yes')}>
          Да, состоялась
        </Button>
        <Button size="sm" variant="secondary" disabled={isPending} onClick={sayNo}>
          Нет
        </Button>
      </div>
    </section>
  );
}
