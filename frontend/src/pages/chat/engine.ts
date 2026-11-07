import { dayjs } from '@/lib/dates';
import { normalize } from '@/lib/text';
import type { AssistantDraft, MatchOption } from '@/types/api';
import type { CompanionInput, EventInput } from '@/types/inputs';

import type { AssistantAction, AssistantActionParams } from './actions';
import { KNOWLEDGE, SITE_MAP, type AssistantRole, type KnowledgeTopic } from './knowledge';
import { chatReply, type ChatAnswer, type ChatClient, type ChatContext } from './model';

/**
 * Помощник без модели: база знаний о сайте, переходы, действия за человека и подбор встреч
 * системой рекомендаций (`/assistant/match`). Так же отвечает, если модель недоступна.
 */

export interface LocalClient extends ChatClient {
  draft: <T>(kind: 'event' | 'companion', text: string) => Promise<AssistantDraft<T>>;
  sportName: (id: string) => string | undefined;
  districtName: (id: string) => string | undefined;
  myEvents: () => Promise<{ id: string; title: string; startsAt: string }[]>;
  role: AssistantRole;
}

const CANCEL = /^(отмена|отмени|стоп|не надо|передумал|передумала|хватит|нет спасибо|не нужно)( |$)/;
const HOW =
  /(^| )(как|где|куда|зачем|почему|что такое|что значит|что делать|можно ли|не могу|не получается|не работает|помоги|подскажи|объясни|что будет)( |$)/;
const NAVIGATE = /^(открой|открыть|перейди|перейти|покажи|показать|зайди|отведи|верни)( |$)/;
const CREATE_EVENT =
  /(созда(ть|й|м|ю)|организ(овать|ую|уй)|провести|проведу|собрать|соберу|устроить|запусти(ть)?|опубликуй|новую|новое) .*(встреч|мероприят|игр|тренировк|событи|матч|турнир|пробежк|прогулк)|(встреч|мероприят|событи)\S* .*(созда|организ)/;
const COMPANION = /(ищу компанию|найди (мне )?компанию|объявлени|ищу напарник|ищу с кем|не с кем)/;
const JOIN = /(запиши|записать|запишите|записаться|запишусь|хочу пойти на|пойду на|иду на)/;
const LEAVE =
  /(отмени|отменить|отписаться|отпиши|выйти из|не смогу прийти|не пойду|убери запись|удали запись)/;
const FAVORITE = /(в избранное|сохрани|добавь в закладки|запомни встреч)/;
const PROFILE = /(интерес|мой район|живу (в|на)|поменяй район|смени район|добавь .* в профиль)/;
const ORDINALS: [RegExp, number][] = [
  [/(^| )(перв\S*|1)( |$)/, 0],
  [/(^| )(втор\S*|2)( |$)/, 1],
  [/(^| )(трет\S*|3)( |$)/, 2],
  [/(^| )(последн\S*)( |$)/, -1],
];

/** Чем база знаний ответит на вопрос: лучшая тема и её вес. */
export function findTopic(
  text: string,
  role: AssistantRole,
): { topic: KnowledgeTopic; score: number } | null {
  const t = ` ${normalize(text)} `;
  let best: { topic: KnowledgeTopic; score: number } | null = null;
  for (const topic of KNOWLEDGE) {
    if (topic.roles && !topic.roles.includes(role) && !(role === 'organizer' && topic.roles.includes('user')))
      continue;
    let score = 0;
    for (const k of topic.keywords) {
      const key = normalize(k);
      if (key && t.includes(key)) score += Math.min(key.length, 12);
    }
    const titleWords = normalize(topic.title)
      .split(' ')
      .filter((w) => w.length > 4);
    for (const w of titleWords) if (t.includes(w.slice(0, Math.max(4, w.length - 2)))) score += 2;
    if (!best || score > best.score) best = { topic, score };
  }
  return best && best.score >= 5 ? best : null;
}

function topicAnswer(topic: KnowledgeTopic): ChatAnswer {
  const doable: Record<string, string> = {
    create_event: 'Создайте встречу за меня',
    create_companion: 'Напишите объявление за меня',
    search_events: 'Подберите мне встречу',
  };
  const say = topic.action && doable[topic.action] ? [doable[topic.action]!] : undefined;
  return { text: topic.answer, steps: topic.steps, links: topic.links.slice(0, 3), say };
}

function findPage(text: string) {
  const t = normalize(text).replace(NAVIGATE, '').trim();
  if (!t) return null;
  let best: { path: string; title: string; score: number } | null = null;
  for (const page of SITE_MAP) {
    if (page.path.includes(':')) continue;
    const words = normalize(page.title)
      .split(' ')
      .filter((w) => w.length > 2);
    const score =
      words.filter((w) => t.includes(w.slice(0, Math.max(3, w.length - 2)))).length / (words.length || 1);
    if (score > 0 && (!best || score > best.score)) best = { path: page.path, title: page.title, score };
  }
  return best && best.score >= 0.5 ? best : null;
}

function pickCard(text: string, cards: { id: string; title: string }[]) {
  const t = normalize(text);
  for (const [re, index] of ORDINALS) if (re.test(t)) return cards.at(index) ?? null;
  const scored = cards
    .map((c) => ({
      c,
      n: normalize(c.title)
        .split(' ')
        .filter((w) => w.length > 3 && t.includes(w.slice(0, -1))).length,
    }))
    .sort((a, b) => b.n - a.n);
  if (scored[0]?.n) return scored[0].c;
  return cards.length === 1 ? cards[0]! : null;
}

/** Черновик сервера → параметры действия «Создать встречу» и чего ещё не хватает. */
function eventParams(draft: AssistantDraft<EventInput>, client: LocalClient) {
  const d = draft.draft;
  const params: AssistantActionParams = {};
  const sport = d.sportId ? client.sportName(d.sportId) : (d.newSportName ?? draft.newSport?.name);
  if (sport) params.sport = sport;
  if (d.title) params.title = d.title;
  // Описание без самой просьбы к помощнику: «Создай встречу: …» → «…»
  const description = d.description
    ?.replace(
      /^(пожалуйста\s+)?(создай(те)?|создать|хочу создать|организуй(те)?|проведи)\s+(мне\s+)?(свою\s+)?(встречу|мероприятие|событие|игру|тренировку)[\s:,.-]*/i,
      '',
    )
    .trim();
  if (description) params.description = description.charAt(0).toUpperCase() + description.slice(1);
  if (d.startsAt) {
    // Время встречи — по поясу города, а не устройства
    const s = dayjs(d.startsAt);
    params.date = s.format('YYYY-MM-DD');
    params.time = s.format('HH:mm');
  }
  if (d.durationMin) params.durationMin = d.durationMin;
  if (d.place?.address) params.address = d.place.address;
  if (d.place?.districtId) params.district = client.districtName(d.place.districtId);
  if (d.capacity) params.capacity = d.capacity;
  if (d.price) params.price = d.price.kind === 'fixed' ? d.price.amount : 0;
  if (d.level) params.level = d.level;
  if (d.joinMode) params.joinMode = d.joinMode;
  const missing: { field: string; question: string; options: string[] }[] = [];
  const ask = (field: string, question: string, options: string[] = []) => {
    const q = draft.missing.find((m) => m.field === field || m.field.startsWith(field));
    missing.push({
      field,
      question: q?.question ?? question,
      options: q?.options.map((o) => o.label).slice(0, 4) ?? options,
    });
  };
  if (!params.sport)
    ask('sport', 'Каким видом спорта будете заниматься?', ['Футбол', 'Волейбол', 'Бег', 'Настольный теннис']);
  if (!params.date || !params.time)
    ask('startsAt', 'Когда встречаемся? Напишите день и время, например «в субботу в 11:00».', [
      'Завтра в 19:00',
      'В субботу в 11:00',
    ]);
  if (!params.address) ask('place', 'Где встречаемся? Напишите адрес или понятное место.', []);
  return { params, missing };
}

function summary(p: AssistantActionParams) {
  const when = [
    p.date
      ? new Date(`${p.date}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
      : '',
    p.time,
  ]
    .filter(Boolean)
    .join(', ');
  return `Создать встречу «${p.title ?? p.sport}»${when ? `, ${when}` : ''}`;
}

async function eventFlow(text: string, context: ChatContext | null, client: LocalClient, round: number) {
  const draft = await client.draft<EventInput>('event', text);
  const { params, missing } = eventParams(draft, client);
  if (!missing.length || round >= 4) {
    if (missing.length)
      return {
        answer: {
          text: 'Не хватает нескольких сведений. Откройте форму: всё, что вы рассказали, уже перенесено туда.',
          links: [{ label: 'Открыть форму', to: `/events/new?description=${encodeURIComponent(text)}` }],
        },
        context: { ...(context ?? emptyContext()), pending: undefined },
      };
    const action: AssistantAction = { type: 'create_event', summary: summary(params), params };
    return {
      answer: {
        text: 'Черновик готов. Проверьте карточку и нажмите «Подтвердить», чтобы опубликовать встречу. Если нужны правки, напишите, что изменить.',
        action,
      },
      context: { ...(context ?? emptyContext()), pending: { kind: 'event' as const, text, round } },
    };
  }
  const next = missing[0]!;
  const understood = [
    params.sport,
    params.date && params.time ? `${params.date} ${params.time}` : '',
    params.address,
  ]
    .filter(Boolean)
    .join(', ');
  return {
    answer: {
      text: `${understood ? `Записал: ${understood}. ` : 'Помогу создать встречу. '}${next.question}`,
      say: next.options.length ? next.options : undefined,
      links: [{ label: 'Заполнить форму самому', to: '/events/new' }],
    },
    context: { ...(context ?? emptyContext()), pending: { kind: 'event' as const, text, round: round + 1 } },
  };
}

const emptyContext = (): ChatContext => ({ text: '', filters: {}, asked: [] });

export async function localReply(
  text: string,
  context: ChatContext | null,
  cityId: string,
  client: LocalClient,
  choice?: MatchOption,
): Promise<{ answer: ChatAnswer; context: ChatContext | null }> {
  if (choice) return withCards(await chatReply(text, context, cityId, client, choice), context);
  const t = normalize(text);
  const cards = context?.cards ?? [];
  if (
    /(девочк|девушк|парня|отношени)/.test(t) &&
    !/(спорт|футбол|волейбол|баскетбол|бег|теннис|плаван|йог|танц|прогулк|поход|тренировк)/.test(t)
  )
    return {
      answer: {
        text: 'Здесь можно найти партнёра для занятий спортом. Укажите вид спорта и удобное время или откройте раздел «Ищу компанию».',
        links: [{ label: 'Ищу компанию', to: '/companions' }],
        say: ['Хочу на пробежку', 'Ищу компанию для тенниса'],
      },
      context,
    };

  // Продолжение начатого: создаём встречу по шагам
  const pending = context?.pending;
  if (pending && CANCEL.test(t))
    return {
      answer: { text: 'Хорошо, отменил. Чем ещё помочь?' },
      context: { ...context!, pending: undefined },
    };
  if (pending?.kind === 'event' && !NAVIGATE.test(t) && !HOW.test(t))
    return eventFlow(`${pending.text}. ${text}`, context, client, pending.round);

  if (
    /^(привет|здравствуй|здравствуйте|добрый день|добрый вечер|доброе утро)( |$)/.test(t) &&
    t.split(' ').length <= 3
  )
    return {
      answer: {
        text: 'Здравствуйте! Напишите, какую встречу ищете, или задайте вопрос о сайте. Если захотите записаться или что-то опубликовать, я попрошу подтверждение.',
        say: ['Подберите мне встречу', 'Создайте встречу за меня', 'Как записаться?'],
      },
      context,
    };
  if (/^(спасибо|благодарю|спс)( |$)/.test(t))
    return { answer: { text: 'Пожалуйста. Если что-то понадобится, пишите.' }, context };

  if (NAVIGATE.test(t)) {
    const page = findPage(text);
    if (page)
      return {
        answer: {
          text: `Открываю «${page.title}».`,
          action: { type: 'navigate', summary: `Открыть «${page.title}»`, params: { path: page.path } },
          autoRun: true,
        },
        context,
      };
  }

  if (CREATE_EVENT.test(t) || /^созда(йте|й) встречу за меня/.test(t)) {
    if (client.role === 'guest')
      return {
        answer: {
          text: 'Создавать встречи можно после входа на сайт.',
          links: [{ label: 'Войти', to: '/login?to=/assistant' }],
        },
        context,
      };
    return eventFlow(text, context, client, 0);
  }

  if (COMPANION.test(t) && !HOW.test(t)) {
    if (/^напишите объявление за меня/.test(t))
      return {
        answer: {
          text: 'Напишите, с кем, чем и когда хотите заниматься. Например: «ищу компанию на пробежку по утрам в Октябрьском районе».',
        },
        context,
      };
    const draft = await client.draft<CompanionInput>('companion', text);
    const d = draft.draft;
    const sport = d.sportId ? client.sportName(d.sportId) : (d.newSportName ?? draft.newSport?.name);
    if (!sport)
      return {
        answer: { text: 'Каким видом спорта хотите заниматься? Напишите, и я составлю объявление.' },
        context,
      };
    const params: AssistantActionParams = {
      sport,
      text: d.text ?? text,
      when: d.when,
      district: d.districtId ? client.districtName(d.districtId) : undefined,
      level: d.level,
    };
    return {
      answer: {
        text: 'Составил объявление «Ищу компанию». Проверьте и нажмите «Подтвердить», и я его опубликую.',
        action: { type: 'create_companion', summary: `Опубликовать объявление: ${sport}`, params },
      },
      context,
    };
  }

  if (LEAVE.test(t) && !HOW.test(t)) {
    if (client.role === 'guest')
      return {
        answer: {
          text: 'Войдите, чтобы управлять своими записями.',
          links: [{ label: 'Войти', to: '/login?to=/me' }],
        },
        context,
      };
    const mine = await client.myEvents();
    const target = pickCard(text, mine);
    if (target)
      return {
        answer: {
          text: `Отменить запись на «${target.title}»?`,
          action: {
            type: 'leave_event',
            summary: `Отменить запись на «${target.title}»`,
            params: { eventId: target.id },
          },
        },
        context,
      };
    if (!mine.length)
      return {
        answer: {
          text: 'Сейчас у вас нет записей на будущие встречи.',
          links: [{ label: 'Мои занятия', to: '/me' }],
        },
        context,
      };
    return {
      answer: {
        text: 'На какую встречу отменить запись?',
        say: mine.slice(0, 4).map((e) => `Отмени запись на «${e.title}»`),
        links: [{ label: 'Мои занятия', to: '/me' }],
      },
      context,
    };
  }

  if (JOIN.test(t) && !HOW.test(t) && cards.length) {
    const card = pickCard(text, cards);
    if (card)
      return {
        answer: {
          text: `Записать вас на «${card.title}»?`,
          action: {
            type: 'join_event',
            summary: `Записаться на «${card.title}»`,
            params: { eventId: card.id },
          },
        },
        context,
      };
    return {
      answer: {
        text: 'На какую из встреч записать?',
        say: cards.slice(0, 3).map((c) => `Запиши на «${c.title}»`),
      },
      context,
    };
  }

  if (FAVORITE.test(t) && cards.length) {
    const card = pickCard(text, cards);
    if (card)
      return {
        answer: {
          text: `Сохранить «${card.title}» в избранное?`,
          action: {
            type: 'favorite_event',
            summary: `В избранное: «${card.title}»`,
            params: { eventId: card.id },
          },
        },
        context,
      };
  }

  if (PROFILE.test(t) && !HOW.test(t) && client.role !== 'guest') {
    const parsed = await client.parse(text);
    const interests = (parsed.filters.sportIds ?? [])
      .map((id) => client.sportName(id))
      .filter(Boolean) as string[];
    const district = parsed.filters.districtId ? client.districtName(parsed.filters.districtId) : undefined;
    if (interests.length || district)
      return {
        answer: {
          text: 'Обновить профиль? От этого зависит подборка «Для вас».',
          action: {
            type: 'update_profile',
            summary: [
              interests.length ? `Добавить в интересы: ${interests.join(', ')}` : '',
              district ? `район: ${district}` : '',
            ]
              .filter(Boolean)
              .join('; '),
            params: { interests, district },
          },
        },
        context,
      };
  }

  const found = findTopic(text, client.role);
  let searchIntent = false;
  if (found && !HOW.test(t)) {
    const parsed = await client.parse(text);
    searchIntent =
      Boolean(context?.text) ||
      /(^| )(подбери\S*|найди|найдите|хочу|поиграть|побегать|позаниматься)( |$)/.test(t) ||
      Object.entries(parsed.filters).some(([key, value]) => key !== 'q' && Boolean(value));
  }
  if (found && !searchIntent && (HOW.test(t) || found.score >= 9))
    return { answer: topicAnswer(found.topic), context };

  const result = await chatReply(text, context, cityId, client);
  // Ничего не нашлось, а вопрос похож на тему из базы знаний — подсказываем и её
  if (found && !searchIntent && !result.answer.cards?.length)
    return { answer: { ...topicAnswer(found.topic) }, context: result.context };
  return withCards(result, context);
}

function withCards(
  result: { answer: ChatAnswer; context: ChatContext | null },
  previous: ChatContext | null,
) {
  const cards = result.answer.cards?.map((c) => ({ id: c.id, title: c.title }));
  const context = result.context ?? previous;
  return { answer: result.answer, context: cards?.length && context ? { ...context, cards } : context };
}
