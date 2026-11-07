import { useList } from '@refinedev/core';

import type { MessageView } from '@/types/api';

/** Вопрос без ответа организатора: не системное, не от организатора и без ответа от него. */
export function unansweredQuestions(messages: MessageView[]): MessageView[] {
  const answered = new Set(
    messages.filter((m) => m.author?.isOrganizer && m.replyTo).map((m) => m.replyTo as string),
  );
  return messages.filter(
    (m) =>
      !m.system && m.text !== null && m.author && !m.author.isOrganizer && !m.replyTo && !answered.has(m.id),
  );
}

export function useEventMessages(eventId: string) {
  const { result, query } = useList<MessageView>({
    resource: 'messages',
    filters: [{ field: 'eventId', operator: 'eq', value: eventId }],
    pagination: { mode: 'off' },
    liveMode: 'auto',
  });
  return { messages: result.data, query };
}
