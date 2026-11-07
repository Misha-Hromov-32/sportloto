import { ArrowBendUpLeftIcon, ChatCircleDotsIcon } from '@phosphor-icons/react';

import { Button, DiscussionMessage, EmptyState, ErrorState, SkeletonBlock, StatusBadge } from '@/components';
import { count, WORDS } from '@/lib/plural';
import type { MessageView } from '@/types/api';

import styles from './manage.module.css';
import { unansweredQuestions } from './manageData';

export function DiscussionPanel({
  eventId,
  messages,
  isLoading,
  isError,
  onRetry,
}: {
  eventId: string;
  messages: MessageView[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}) {
  const discussionLink = `/events/${eventId}#discussion`;
  if (isError) {
    return <ErrorState onRetry={onRetry}>Не удалось загрузить обсуждение. Нажмите «Повторить».</ErrorState>;
  }
  if (isLoading) {
    return (
      <div className={styles.thread} aria-hidden>
        <SkeletonBlock height={96} />
        <SkeletonBlock height={96} />
      </div>
    );
  }
  const visible = messages.filter((m) => !m.system);
  if (!visible.length) {
    return (
      <EmptyState
        title="Вопросов пока нет"
        icon={<ChatCircleDotsIcon size={28} aria-hidden />}
        actions={
          <Button variant="secondary" to={discussionLink}>
            Открыть обсуждение
          </Button>
        }
      >
        Когда кто-то спросит про событие, вопрос появится здесь и в уведомлениях.
      </EmptyState>
    );
  }

  const open = unansweredQuestions(messages);
  const openIds = new Set(open.map((m) => m.id));
  const byId = new Map(messages.map((m) => [m.id, m]));
  const rest = [...visible]
    .filter((m) => !openIds.has(m.id))
    .reverse()
    .slice(0, 6);

  return (
    <div className={styles.thread}>
      {open.length > 0 ? (
        <p className={styles.note}>
          Без ответа: {count(open.length, WORDS.question)}. Ответ увидят все, кто открывает карточку.
        </p>
      ) : (
        <p className={styles.note}>На все вопросы есть ответ.</p>
      )}

      {open.map((m) => (
        <div key={m.id} className={styles.unanswered}>
          <div className={styles.unansweredHead}>
            <StatusBadge kind="custom" meta={{ label: 'Ждёт ответа', tone: 'wait', icon: 'clock' }} />
            <Button
              size="sm"
              variant="secondary"
              to={`/events/${eventId}?reply=${m.id}#discussion`}
              icon={<ArrowBendUpLeftIcon size={20} aria-hidden />}
            >
              Ответить в карточке
            </Button>
          </div>
          <DiscussionMessage message={m} canReact={false} />
        </div>
      ))}

      {rest.length > 0 && <h3 className={styles.subhead}>Последние сообщения</h3>}
      {rest.map((m) => (
        <DiscussionMessage
          key={m.id}
          message={m}
          parent={m.replyTo ? byId.get(m.replyTo) : null}
          canReact={false}
        />
      ))}

      <div>
        <Button variant="quiet" to={discussionLink}>
          Всё обсуждение в карточке
        </Button>
      </div>
    </div>
  );
}
