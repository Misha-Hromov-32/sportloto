import { priceSummary } from '@/lib/money';
import { normalize } from '@/lib/text';
import type { MatchFilters, MatchOption, MatchPatch, MatchResult, ParsedSearch } from '@/types/api';

import type { AssistantAction } from './actions';

export interface ChatContext {
  text: string;
  filters: MatchFilters;
  asked: string[];
  /** Встречи последнего ответа: «запиши на первую». */
  cards?: { id: string; title: string }[];
  /** Начатое по шагам дело: создание встречи. */
  pending?: { kind: 'event'; text: string; round: number };
}
export interface ChatCard {
  id: string;
  title: string;
  sport: string;
  startsAt: string;
  address: string;
  price: string;
  why: string[];
}
export interface ChatAnswer {
  text: string;
  links?: { label: string; to: string }[];
  cards?: ChatCard[];
  choices?: MatchOption[];
  question?: string;
  understood?: string[];
  /** Пошаговая инструкция: куда перейти и что нажать. */
  steps?: string[];
  /** Готовые ответы кнопками: нажатие отправляет текст как сообщение. */
  say?: string[];
  /** Действие за человека: карточка с «Подтвердить». */
  action?: AssistantAction;
  /** Выполнить сразу (переход по прямой просьбе «открой …»). */
  autoRun?: boolean;
  /** Кто ответил: модель или помощник без модели. */
  engine?: 'local' | 'model';
}
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  answer: ChatAnswer;
  retry?: string;
}
export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  context: ChatContext | null;
}
export interface ChatClient {
  parse: (text: string) => Promise<ParsedSearch>;
  match: (input: {
    text: string;
    cityId: string;
    steps: { id: string; patch: MatchPatch }[];
  }) => Promise<MatchResult>;
}
export const EXAMPLES = [
  { title: 'Найти встречу', text: 'Хочу в выходные поиграть в волейбол, я новичок' },
  { title: 'Создать встречу за меня', text: 'Создай встречу: футбол в субботу в 11:00' },
  { title: 'Как записаться', text: 'Как записаться на встречу?' },
  { title: 'Где взять инвентарь', text: 'Где взять инвентарь для игры?' },
];

const MATCH_KEYS: (keyof MatchFilters)[] = [
  'q',
  'sportIds',
  'when',
  'date',
  'dayPart',
  'level',
  'beginners',
  'free',
  'priceMax',
  'joinMode',
  'near',
  'radiusKm',
  'districtId',
  'aroundDistrictId',
  'composition',
  'family',
];

const filtersLink = (filters: MatchFilters, path: string) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined) continue;
    if (key === 'sportIds') params.set('sport', (value as string[]).join(','));
    else if (key === 'aroundDistrictId') {
      params.set('from', String(value));
      params.set('near', '1');
    } else {
      const keys: Record<string, string> = {
        dayPart: 'part',
        beginners: 'new',
        priceMax: 'max',
        radiusKm: 'r',
        districtId: 'district',
        composition: 'who',
        joinMode: 'mode',
      };
      if (value !== false) params.set(keys[key] ?? key, value === true ? '1' : String(value));
    }
  }
  if (path === '/events') params.set('sort', 'relevance');
  return `${path}?${params}`;
};

/** Уточнение заменяет только названные условия, сохраняя предыдущий запрос. */
export function refineFilters(previous: MatchFilters, parsed: ParsedSearch, text: string): MatchFilters {
  const next = { ...previous, ...parsed.filters };
  const t = normalize(text);
  // Нераспознанные вводные слова не должны становиться новым обязательным поиском.
  if (parsed.rest && !previous.q) delete next.q;
  else if (previous.q && parsed.rest) next.q = previous.q;
  if (parsed.filters.districtId) {
    next.aroundDistrictId = parsed.filters.districtId;
    next.near = true;
    next.radiusKm = parsed.filters.radiusKm ?? previous.radiusKm ?? 3;
    delete next.districtId;
  }
  if (/любое время|любой день|все дни|когда угодно|без ограничени.*врем/.test(t)) {
    delete next.when;
    delete next.date;
    delete next.dayPart;
  }
  if (/любое время дня|утром и вечером/.test(t)) delete next.dayPart;
  if (/можно платн|не обязательно бесплат|любая цена/.test(t)) {
    delete next.free;
    delete next.priceMax;
  }
  if (/любой район|не обязательно рядом|по всему город/.test(t)) {
    delete next.districtId;
    delete next.aroundDistrictId;
    delete next.near;
    delete next.radiusKm;
  }
  if (next.when !== 'date') delete next.date;
  return next;
}

export async function chatReply(
  text: string,
  context: ChatContext | null,
  cityId: string,
  client: ChatClient,
  choice?: MatchOption,
): Promise<{ answer: ChatAnswer; context: ChatContext | null }> {
  let filters: MatchFilters | undefined;
  let base = text.replace(/^(привет|здравствуйте|добрый день)[,!.\s]+/iu, '');
  // Уточнение — только если раньше уже был поиск (после справки или создания встречи текста поиска нет)
  const asked = context?.text ? context.asked : [];
  if (context?.text) {
    if (choice) {
      filters = { ...context.filters, ...choice.patch.set };
      for (const key of choice.patch.drop ?? []) delete filters[key];
    } else filters = refineFilters(context.filters, await client.parse(text), text);
    base = context.text;
  }
  // Одна полная поправка не теряет условия даже после длинного диалога.
  const steps = filters
    ? [
        {
          id: 'chat:context',
          patch: {
            set: filters,
            drop: MATCH_KEYS.filter((k) => !(k in filters!)),
          },
        },
        ...asked.map((id) => ({ id, patch: {} })),
      ]
    : [];
  if (choice?.id.startsWith('ask:') && !asked.includes(choice.id)) steps.push({ id: choice.id, patch: {} });
  const result = await client.match({ text: base, cityId, steps });
  const links = [{ label: 'Все результаты в поиске', to: filtersLink(result.filters, '/events') }];
  if (result.companion) links.push({ label: 'Собрать свою компанию', to: '/companions/new' });
  for (const joined of result.joined)
    links.push({ label: `Вы уже идёте: ${joined.title}`, to: `/events/${joined.id}` });
  return {
    answer: {
      text: result.reply,
      understood: result.understood,
      cards: result.items.map(({ event: e, why }) => ({
        id: e.id,
        title: e.title,
        sport: e.sport.name,
        startsAt: e.startsAt,
        address: e.place.address,
        price: priceSummary(e.price, e.counts.confirmed, e.minParticipants).main,
        why,
      })),
      links,
      choices: [...result.questions.flatMap((q) => q.options), ...result.widen],
      question:
        result.questions[0]?.question ?? (result.widen.length ? 'Попробуем поискать шире?' : undefined),
    },
    context: {
      ...context,
      text: base,
      filters: result.filters,
      asked: steps
        .filter((s) => s.id.startsWith('ask:'))
        .map((s) => s.id)
        .slice(-2),
    },
  };
}
