/** Заглушка клиента чата для проверок интерфейса: ответы сервера заданы фикстурами, подбор не считается. */
import type { LocalClient } from '@/pages/chat/engine';
import type { AssistantDraft, MatchFilters, MatchResult, ParsedSearch } from '@/types/api';
import type { CompanionInput, EventInput } from '@/types/inputs';

import { makeEventView } from './event';

const SPORTS: Record<string, string> = {
  's-volleyball': 'Волейбол',
  's-football': 'Футбол',
  's-running': 'Бег',
};

export const VOLLEY_EVENT = makeEventView({
  id: 'e-volley-vzlet',
  title: 'Волейбол на Взлётке',
  sportId: 's-volleyball',
  sport: { id: 's-volleyball', name: 'Волейбол' },
  startsAt: '2030-06-15T12:00:00.000Z',
} as never);

/** Фикстура ответа разбора запроса: какие условия сервер выделил бы из фразы. */
export function parsedFor(text: string): ParsedSearch {
  const t = text.toLowerCase();
  const filters: MatchFilters = {};
  if (t.includes('волейбол')) filters.sportIds = ['s-volleyball'];
  if (t.includes('выходн')) filters.when = 'weekend';
  if (t.includes('завтра')) filters.when = 'tomorrow';
  if (t.includes('новичк')) filters.beginners = true;
  if (t.includes('вечером')) filters.dayPart = 'evening';
  if (t.includes('утром')) filters.dayPart = 'morning';
  if (t.includes('бесплатно')) filters.free = true;
  return { filters, chips: [], rest: '' };
}

/** Фикстура ответа подбора: условия берутся из шага контекста, если он есть, иначе из текста. */
export function matchFor(input: Parameters<LocalClient['match']>[0]): MatchResult {
  const filters = (input.steps[0]?.patch.set as MatchFilters | undefined) ?? parsedFor(input.text).filters;
  const found = input.cityId === 'krasnoyarsk' && Boolean(filters.sportIds?.includes('s-volleyball'));
  return {
    filters,
    understood: [],
    reply: found ? 'Нашёл встречу.' : 'Ничего не нашлось.',
    items: found ? [{ event: VOLLEY_EVENT, why: ['Рядом', 'Для новичков'] }] : [],
    total: found ? 1 : 0,
    questions: [],
    widen: [],
    joined: [],
    companion: null,
  };
}

function eventDraft(text: string): AssistantDraft<EventInput> {
  const full = text.toLowerCase().includes('футбол');
  return {
    kind: 'event',
    draft: full
      ? ({
          sportId: 's-football',
          title: 'Футбол в субботу',
          startsAt: '2030-06-15T04:00:00.000Z',
          place: { address: 'Стадион Локомотив' },
          capacity: 10,
        } as Partial<EventInput>)
      : {},
    filled: [],
    missing: [],
    newSport: null,
  };
}

export function makeLocalClient(): LocalClient {
  return {
    parse: async (text) => parsedFor(text),
    match: async (input) => matchFor(input),
    draft: async <T>(kind: 'event' | 'companion', text: string) =>
      (kind === 'event'
        ? eventDraft(text)
        : ({
            kind: 'companion',
            draft: { sportId: 's-running', text, when: 'по утрам' } as Partial<CompanionInput>,
            filled: [],
            missing: [],
            newSport: null,
          } satisfies AssistantDraft<CompanionInput>)) as AssistantDraft<T>,
    sportName: (id) => SPORTS[id],
    districtName: () => undefined,
    myEvents: async () => [{ id: 'e-volley-vzlet', title: 'Волейбол на Взлётке', startsAt: '' }],
    role: 'user',
  };
}
