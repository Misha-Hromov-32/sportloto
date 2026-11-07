import {
  ArrowRight,
  CalendarX,
  CheckCircle,
  ClockCounterClockwise,
  Play,
  Prohibit,
  Trash,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { formatAgo } from '@/lib/dates';
import type { EventChange, EventState, Moderation, PlatformRule } from '@/types/domain';

import { Button } from '../Button/Button';
import styles from './EventBanners.module.css';

interface ChangeBannerProps {
  changes: EventChange[];
  /** Изменения, которые этот человек ещё не подтвердил. */
  unackedIds: string[];
  onAcknowledge?: () => void;
  acknowledging?: boolean;
  /** Второе действие рядом с «Я в курсе», например «Не смогу в новое время». */
  secondaryAction?: ReactNode;
}

/** «Было → стало» с подтверждением «Я в курсе». После подтверждения сворачивается в одну строку. */
export function ChangeBanner({
  changes,
  unackedIds,
  onAcknowledge,
  acknowledging,
  secondaryAction,
}: ChangeBannerProps) {
  const pending = changes.filter((c) => unackedIds.includes(c.id));
  if (!changes.length) return null;
  if (!pending.length) {
    const last = changes[changes.length - 1]!;
    return (
      <p className={styles.acked}>
        <CheckCircle size={20} weight="fill" aria-hidden />
        Вы в курсе изменений от {formatAgo(last.at)}
      </p>
    );
  }
  return (
    <section className={[styles.banner, styles.wait, 'status-flash'].join(' ')} aria-live="polite">
      <ClockCounterClockwise size={24} aria-hidden className={styles.icon} />
      <div className={styles.body}>
        <h2 className={styles.title}>Событие изменилось</h2>
        <ul className={styles.changes}>
          {pending.flatMap((c) =>
            c.items.map((item) => (
              <li key={`${c.id}-${item.field}`} className={styles.change}>
                <span className={styles.changeLabel}>{item.label}</span>
                <span className={styles.from}>
                  <span className="sr-only">было </span>
                  {item.from}
                </span>
                <ArrowRight size={18} aria-hidden className={styles.arrow} />
                <span className={styles.to}>
                  <span className="sr-only">стало </span>
                  {item.to}
                </span>
              </li>
            )),
          )}
        </ul>
        {onAcknowledge && (
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onAcknowledge} loading={acknowledging}>
              Я в курсе
            </Button>
            {secondaryAction}
            <span className={styles.note}>Организатор увидит, что вы знаете об изменениях</span>
          </div>
        )}
      </div>
    </section>
  );
}

interface EventStateBannerProps {
  state: EventState;
  cancelReason?: string;
  moderation?: Moderation | null;
  rule?: PlatformRule | null;
  /** Для организатора — что делать дальше. */
  isOrganizer?: boolean;
  /** Есть ли у человека запись (тогда объясняем, что с ней). */
  hadParticipation?: boolean;
  actions?: ReactNode;
}

/** Плашка состояния события: отменено, снято модератором, прошло, идёт сейчас, удалено. */
export function EventStateBanner({
  state,
  cancelReason,
  moderation,
  rule,
  isOrganizer,
  hadParticipation,
  actions,
}: EventStateBannerProps) {
  if (state === 'upcoming') return null;

  const content: Record<
    Exclude<EventState, 'upcoming'>,
    { icon: ReactNode; tone: string; title: string; text: ReactNode }
  > = {
    cancelled: {
      icon: <CalendarX size={24} aria-hidden />,
      tone: styles.off!,
      title: 'Организатор отменил событие',
      text: (
        <>
          {cancelReason && <p>Причина: {cancelReason}</p>}
          <p>Записаться нельзя.{hadParticipation ? ' Если вы платили, деньги вернут полностью.' : ''}</p>
        </>
      ),
    },
    removed: {
      icon: <Prohibit size={24} aria-hidden />,
      tone: styles.danger!,
      title: 'Снято с публикации модератором',
      text: (
        <>
          {rule && (
            <p>
              Нарушено правило {rule.number}: <Link to={`/rules#${rule.id}`}>{rule.title}</Link>
            </p>
          )}
          {moderation?.comment && <p>Комментарий: {moderation.comment}</p>}
          <p>
            {isOrganizer
              ? 'Событие не видно в поиске, записаться на него нельзя. Записи участников приостановлены и восстановятся, когда событие вернут. Исправьте карточку в управлении и попросите вернуть событие.'
              : hadParticipation
                ? 'Ваша запись приостановлена: если событие вернут, она восстановится сама. Пока его нет в поиске.'
                : 'Записаться нельзя, даже по прямой ссылке.'}
          </p>
        </>
      ),
    },
    deleted: {
      icon: <Trash size={24} aria-hidden />,
      tone: styles.off!,
      title: moderation ? 'Событие удалено модератором' : 'Событие удалено',
      text: (
        <>
          {rule && (
            <p>
              Нарушено правило {rule.number}: <Link to={`/rules#${rule.id}`}>{rule.title}</Link>
            </p>
          )}
          {moderation?.comment && <p>Комментарий: {moderation.comment}</p>}
          <p>
            {isOrganizer
              ? 'Событие не видно в поиске, записаться на него нельзя. Участники получили уведомление с причиной.'
              : 'Записаться нельзя, даже по прямой ссылке.'}
          </p>
        </>
      ),
    },
    past: {
      icon: <ClockCounterClockwise size={24} aria-hidden />,
      tone: styles.off!,
      title: 'Событие уже прошло',
      text: <p>Записаться нельзя. Посмотрите похожие события в поиске.</p>,
    },
    live: {
      icon: <Play size={24} weight="fill" aria-hidden />,
      tone: styles.accent!,
      title: 'Событие уже идёт',
      text: <p>Запись закрыта. Участников ждут на месте.</p>,
    },
  };
  const c = content[state];
  return (
    <section className={[styles.banner, c.tone].join(' ')} role="status">
      <span className={styles.icon}>{c.icon}</span>
      <div className={styles.body}>
        <h2 className={styles.title}>{c.title}</h2>
        <div className={styles.text}>{c.text}</div>
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </section>
  );
}
