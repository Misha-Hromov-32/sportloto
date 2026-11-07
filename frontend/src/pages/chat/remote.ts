import { priceSummary } from '@/lib/money';
import type { MatchResult } from '@/types/api';

import type { AssistantAction } from './actions';
import type { ChatAnswer, ChatMessage } from './model';

export type AiFeature =
  | 'chat'
  | 'forms'
  | 'search'
  | 'premoderation'
  | 'covers'
  | 'profile'
  | 'digest'
  | 'bots'
  | 'mcp';

/** Режим помощника и что включено в админке (`/admin/assistant`). */
export interface AssistantMode {
  mode: 'builtin' | 'local' | 'websocket' | 'api';
  ready: boolean;
  images?: boolean;
  features: Record<AiFeature, boolean>;
}

export interface RemoteReply {
  text: string;
  links: { label: string; to: string }[];
  search: string | null;
  action: AssistantAction | null;
  question: string | null;
  options: string[];
  match: MatchResult | null;
  engine: string;
}

export const ASSISTANT_API = {
  config: '/assistant/config',
  chat: '/assistant/chat',
  admin: '/admin/assistant',
  bridgeKey: '/admin/assistant/bridge-key',
  test: '/admin/assistant/test',
} as const;

/** Переписка для модели: текст ответов и встречи, которые были показаны (с id, чтобы «запиши на первую» работало). */
export function historyFor(messages: ChatMessage[], prompt: string) {
  const out = messages.slice(-11).map((m) => {
    const cards = m.answer.cards?.length
      ? `\n[Показаны встречи: ${m.answer.cards.map((c, i) => `${i + 1}) id=${c.id} «${c.title}»`).join('; ')}]`
      : '';
    const steps = m.answer.steps?.length ? `\n${m.answer.steps.join('\n')}` : '';
    return { role: m.role, text: `${m.answer.text}${steps}${cards}` };
  });
  return [...out, { role: 'user' as const, text: prompt }];
}

export function fromRemote(reply: RemoteReply): ChatAnswer {
  const match = reply.match;
  return {
    text: reply.text,
    links: [
      ...reply.links,
      ...(match?.items.length && !reply.links.some((l) => l.to.startsWith('/events?'))
        ? [
            {
              label: 'Все результаты в поиске',
              to: `/events?phrase=${encodeURIComponent(reply.search ?? '')}`,
            },
          ]
        : []),
    ].slice(0, 4),
    cards: match?.items.map(({ event: e, why }) => ({
      id: e.id,
      title: e.title,
      sport: e.sport.name,
      startsAt: e.startsAt,
      address: e.place.address,
      price: priceSummary(e.price, e.counts.confirmed, e.minParticipants).main,
      why,
    })),
    question: reply.question ?? undefined,
    say: reply.options.length ? reply.options : undefined,
    action: reply.action ?? undefined,
    engine: 'model',
  };
}
