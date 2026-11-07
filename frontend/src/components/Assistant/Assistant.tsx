import { Sparkle, WarningCircle, Robot } from '@phosphor-icons/react';
import { useId, useState, type ReactNode } from 'react';

import type { DraftQuestion } from '@/types/api';
import type { AiFlag } from '@/types/domain';

import { Button } from '../Button/Button';
import styles from './Assistant.module.css';

/** Пометка у поля: «Заполнил помощник» и раскрывающееся «почему так». */
export function AssistantMark({ why }: { why?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={styles.markWrap}>
      <span className={styles.mark}>
        <Sparkle size={14} weight="fill" aria-hidden />
        Заполнил помощник
      </span>
      {why && (
        <>
          <button
            type="button"
            className={styles.why}
            aria-expanded={open}
            aria-controls={id}
            onClick={() => setOpen((v) => !v)}
          >
            Почему так
          </button>
          {open && (
            <span id={id} className={styles.whyText} role="note">
              {why}
            </span>
          )}
        </>
      )}
    </span>
  );
}

const FLAG_TITLE: Record<Exclude<AiFlag, 'none'>, string> = {
  spam: 'Похоже на спам',
  toxic: 'Похоже на грубость',
  suspicious: 'Стоит проверить внимательнее',
};

/** Пометка предмодерации. Ничего не скрывает сама: решение за человеком. */
export function AssistantFlag({ flag, reason }: { flag: AiFlag; reason: string }) {
  if (flag === 'none') return null;
  return (
    <div className={styles.flag} role="note">
      <Robot size={20} aria-hidden />
      <div>
        <p className={styles.flagTitle}>Помощник: {FLAG_TITLE[flag].toLowerCase()}</p>
        {reason && <p className={styles.flagReason}>{reason}</p>}
        <p className={styles.flagHint}>Это подсказка. Решение принимает человек.</p>
      </div>
    </div>
  );
}

/** «Помощник думает…» — без мерцаний, просто текст и спокойный индикатор. */
export function AssistantThinking({ text = 'Помощник думает…' }: { text?: string }) {
  return (
    <div className={styles.thinking} role="status" aria-live="polite">
      <Sparkle size={22} weight="fill" aria-hidden className={styles.thinkingIcon} />
      <span>{text}</span>
    </div>
  );
}

/** Запасной путь, когда помощник не ответил: ручная форма, текст пользователя сохранён. */
export function AssistantUnavailable({
  onManual,
  children,
}: {
  onManual?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className={styles.unavailable} role="alert">
      <WarningCircle size={24} aria-hidden />
      <div className={styles.unavailableBody}>
        <p className={styles.unavailableTitle}>Помощник сейчас недоступен</p>
        <p>{children ?? 'Ваш текст уже в описании. Остальные поля заполните сами.'}</p>
        {onManual && (
          <Button variant="secondary" size="sm" onClick={onManual}>
            Заполнить вручную
          </Button>
        )}
      </div>
    </div>
  );
}

/** Уточняющий вопрос помощника с готовыми ответами-кнопками. */
export function AssistantQuestion({
  question,
  onAnswer,
  onCustom,
}: {
  question: DraftQuestion;
  onAnswer: (value: unknown, label: string) => void;
  onCustom?: () => void;
}) {
  return (
    <fieldset className={styles.question}>
      <legend className={styles.questionTitle}>
        <Sparkle size={18} weight="fill" aria-hidden />
        {question.question}
      </legend>
      <div className={styles.options}>
        {question.options.map((o) => (
          <Button
            key={String(o.label)}
            variant="secondary"
            size="sm"
            onClick={() => onAnswer(o.value, o.label)}
          >
            {o.label}
          </Button>
        ))}
        {question.allowCustom && onCustom && (
          <Button variant="quiet" size="sm" onClick={onCustom}>
            Другое
          </Button>
        )}
      </div>
    </fieldset>
  );
}

/** Заголовок результата: «Вот что я понял — проверьте». */
export function AssistantResultHeader({ children }: { children?: ReactNode }) {
  return (
    <div className={styles.result}>
      <Sparkle size={22} weight="fill" aria-hidden />
      <div>
        <p className={styles.resultTitle}>Вот что я понял. Проверьте, всё ли верно</p>
        <p className={styles.resultText}>
          {children ?? 'Поля с пометкой заполнил помощник. Любое можно поправить.'}
        </p>
      </div>
    </div>
  );
}
