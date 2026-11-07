import {
  ArrowBendUpLeft,
  CalendarCheck,
  EyeSlash,
  HandsClapping,
  Info,
  ThumbsUp,
  Trash,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { formatAgo } from '@/lib/dates';
import { truncate } from '@/lib/text';
import type { MessageView } from '@/types/api';
import type { ReactionKey } from '@/types/domain';

import { AssistantFlag } from '../Assistant/Assistant';
import { Avatar } from '../Avatar/Avatar';
import styles from './DiscussionMessage.module.css';

const REACTIONS: { key: ReactionKey; label: string; icon: ReactNode }[] = [
  { key: 'thanks', label: 'Спасибо', icon: <HandsClapping size={18} aria-hidden /> },
  { key: 'agree', label: 'Полезно', icon: <ThumbsUp size={18} aria-hidden /> },
  { key: 'going', label: 'Тоже иду', icon: <CalendarCheck size={18} aria-hidden /> },
];

interface DiscussionMessageProps {
  message: MessageView;
  /** Сообщение, на которое отвечают, — для цитаты. */
  parent?: MessageView | null;
  onReply?: (message: MessageView) => void;
  onReact?: (message: MessageView, key: ReactionKey) => void;
  onHide?: (message: MessageView) => void;
  onDelete?: (message: MessageView) => void;
  /** Показать пометку помощника (в админке и у организатора). */
  showFlag?: boolean;
  canReact?: boolean;
}

/** Сообщение обсуждения. Ответ организатора помечен и визуально отличается от вопросов. */
export function DiscussionMessage({
  message,
  parent,
  onReply,
  onReact,
  onHide,
  onDelete,
  showFlag,
  canReact = true,
}: DiscussionMessageProps) {
  if (message.system) {
    return (
      <div className={styles.system} role="note">
        <Info size={20} aria-hidden />
        <p>{message.text}</p>
        <time className={styles.time} dateTime={message.createdAt}>
          {formatAgo(message.createdAt)}
        </time>
      </div>
    );
  }

  const author = message.author;
  const isOrganizer = Boolean(author?.isOrganizer);
  const name = author?.orgName ?? author?.name ?? 'Участник';

  if (message.text === null) {
    return (
      <div className={styles.removed}>
        <EyeSlash size={20} aria-hidden />
        <p>{message.status === 'deleted' ? 'Сообщение удалено автором' : 'Сообщение скрыто модератором'}</p>
      </div>
    );
  }

  return (
    <article
      className={[
        styles.message,
        isOrganizer && styles.organizer,
        message.status === 'hidden' && styles.hiddenForAdmin,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <Avatar
        name={name}
        src={author?.orgLogoUrl ?? author?.avatarUrl}
        size={40}
        shape={author?.orgName ? 'org' : 'person'}
      />
      <div className={styles.body}>
        <header className={styles.head}>
          <span className={styles.name}>{name}</span>
          {isOrganizer && <span className={styles.badge}>Организатор</span>}
          {message.mine && !isOrganizer && <span className={styles.mine}>Вы</span>}
          <time className={styles.time} dateTime={message.createdAt}>
            {formatAgo(message.createdAt)}
          </time>
        </header>

        {parent && (
          <p className={styles.quote}>
            <ArrowBendUpLeft size={16} aria-hidden />
            <span>
              В ответ {parent.author?.orgName ?? parent.author?.name ?? 'участнику'}: «
              {truncate(parent.text ?? 'сообщение скрыто', 90)}»
            </span>
          </p>
        )}

        <p className={styles.text}>{message.text}</p>

        {message.status === 'hidden' && (
          <p className={styles.hiddenNote}>Скрыто модератором: {message.hiddenReason}</p>
        )}
        {showFlag && message.aiFlag !== 'none' && (
          <AssistantFlag flag={message.aiFlag} reason={message.aiReason} />
        )}

        <footer className={styles.actions}>
          {REACTIONS.map((r) => {
            const count = message.reactions[r.key]?.length ?? 0;
            const active = message.myReactions.includes(r.key);
            if (!canReact && count === 0) return null;
            return (
              <button
                key={r.key}
                type="button"
                className={[styles.reaction, active && styles.reactionOn].filter(Boolean).join(' ')}
                aria-pressed={active}
                onClick={() => onReact?.(message, r.key)}
                disabled={!canReact || !onReact}
                aria-label={`${r.label}${count ? `, ${count}` : ''}`}
              >
                {r.icon}
                <span className={styles.reactionLabel}>{r.label}</span>
                {count > 0 && <span className={styles.reactionCount}>{count}</span>}
              </button>
            );
          })}
          {onReply && (
            <button type="button" className={styles.action} onClick={() => onReply(message)}>
              <ArrowBendUpLeft size={18} aria-hidden />
              Ответить
            </button>
          )}
          {onHide && message.status === 'visible' && (
            <button type="button" className={styles.action} onClick={() => onHide(message)}>
              <EyeSlash size={18} aria-hidden />
              Скрыть
            </button>
          )}
          {onDelete && message.mine && (
            <button type="button" className={styles.action} onClick={() => onDelete(message)}>
              <Trash size={18} aria-hidden />
              Удалить
            </button>
          )}
        </footer>
      </div>
    </article>
  );
}
