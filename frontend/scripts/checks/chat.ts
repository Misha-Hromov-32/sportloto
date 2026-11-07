/** Чат-помощник: разбор ответов, уточнения, действия за человека и история (клиент — заглушка с фикстурами). */
import assert from 'node:assert/strict';

import { makeLocalClient } from '../fixtures/chat';

const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, value: string) => void memory.set(k, value),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
};
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });

export async function main() {
  const { chatReply } = await import('@/pages/chat/model');
  const { chatKey, newThread, readChats, saveChats } = await import('@/pages/chat/storage');
  const { readFilters } = await import('@/pages/events/feed/filters');
  const check = (name: string, ok: unknown) => {
    assert.ok(ok, name);
    process.stdout.write(`ок  ${name}\n`);
  };
  const local = makeLocalClient();
  const client = { parse: local.parse, match: local.match };
  const first = await chatReply('волейбол в выходные для новичков', null, 'krasnoyarsk', client);
  check(
    'Чат показывает реальные встречи из каталога',
    first.answer.cards?.some((c) => c.id === 'e-volley-vzlet'),
  );
  check(
    'Условия первого сообщения распознаны',
    first.context?.filters.when === 'weekend' && first.context.filters.beginners,
  );
  const evening = await chatReply('А вечером?', first.context, 'krasnoyarsk', client);
  check(
    'Уточнение времени сохраняет направление и день',
    evening.context?.filters.dayPart === 'evening' &&
      evening.context.filters.when === 'weekend' &&
      evening.context.filters.sportIds?.[0] === first.context?.filters.sportIds?.[0],
  );
  const free = await chatReply('Только бесплатно', evening.context, 'krasnoyarsk', client);
  check('Уточнение бесплатности применяется к прежнему поиску', free.context?.filters.free);
  const freeFromStart = await chatReply(
    'волейбол бесплатно в выходные для новичков',
    null,
    'krasnoyarsk',
    client,
  );
  const paid = await chatReply('Можно платно', freeFromStart.context, 'krasnoyarsk', client);
  check('В диалоге можно убрать бесплатность', !paid.context?.filters.free);
  const anyDay = await chatReply('Любой день', paid.context, 'krasnoyarsk', client);
  check(
    'Снятое ранее условие не возвращается из первой фразы',
    !anyDay.context?.filters.free && !anyDay.context?.filters.when,
  );
  const day = await chatReply('Завтра утром', anyDay.context, 'krasnoyarsk', client);
  check(
    'Новая дата заменяет прежнюю, без противоречия',
    day.context?.filters.when === 'tomorrow' && day.context.filters.dayPart === 'morning',
  );
  const allLink = free.answer.links?.find((l) => l.label === 'Все результаты в поиске');
  assert.ok(allLink);
  const url = new URL(allLink.to, 'http://local.test');
  const feed = readFilters(url.searchParams);
  check(
    'Переход в поиск переносит все условия чата',
    feed.sportIds[0] === evening.context?.filters.sportIds?.[0] &&
      feed.when === 'weekend' &&
      feed.dayPart === 'evening' &&
      feed.free &&
      feed.beginners,
  );
  const choice = { id: 'widen:all', label: 'Любое время', patch: { drop: ['dayPart' as const] } };
  const widened = await chatReply(choice.label, evening.context, 'krasnoyarsk', client, choice);
  check(
    'Кнопки расширения действительно меняют подбор',
    !widened.context?.filters.dayPart && widened.context?.filters.when === 'weekend',
  );
  const { localReply } = await import('@/pages/chat/engine');
  const sportSearch = await localReply('Волейбол завтра вечером', null, 'krasnoyarsk', local);
  check(
    'Запрос спорта и времени запускает подбор вместо справки о фильтрах',
    sportSearch.answer.cards?.[0]?.id === 'e-volley-vzlet' &&
      sportSearch.context?.filters.when === 'tomorrow',
  );
  const emptySearch = await localReply('Бег завтра вечером', null, 'krasnoyarsk', local);
  check(
    'Отсутствие встреч сохраняет ответ поиска вместо справочной статьи',
    emptySearch.answer.text === 'Ничего не нашлось.' && !emptySearch.answer.steps,
  );
  const offTopic = await localReply('Я хочу девочку', null, 'krasnoyarsk', {
    ...local,
    match: async () => { throw new Error('Off-topic prompt must not scan events'); },
  });
  check(
    'Посторонняя просьба сразу получает пояснение о спортивном назначении чата',
    offTopic.answer.links?.some((link) => link.to === '/companions'),
  );
  const { render } = await import('../export-assistant-knowledge');
  const { readFileSync } = await import('node:fs');
  const help = await localReply('Где взять инвентарь?', first.context, 'krasnoyarsk', local);
  check(
    'Помощь с инвентарём открывает общую полку',
    help.answer.links?.some((l) => l.to === '/inventory') && Boolean(help.answer.steps?.length),
  );
  check(
    'Справочный вопрос не стирает контекст поиска',
    help.context?.filters.sportIds?.[0] === first.context?.filters.sportIds?.[0],
  );
  const how = await localReply('Как отменить запись на встречу?', null, 'krasnoyarsk', local);
  check(
    'Вопрос «как» получает шаги из базы знаний',
    (how.answer.steps?.length ?? 0) >= 2 && !how.answer.cards,
  );
  const start = await localReply('Хочу создать свою встречу', null, 'krasnoyarsk', local);
  check(
    'Создание встречи начинается с вопросов, без публикации',
    !start.answer.action && start.context?.pending?.kind === 'event',
  );
  const filled = await localReply(
    'футбол в субботу в 11:00, Октябрьский район, стадион Локомотив, 10 человек',
    start.context,
    'krasnoyarsk',
    local,
  );
  const draftAction = filled.answer.action;
  check(
    'Помощник собирает встречу и просит подтвердить',
    draftAction?.type === 'create_event' &&
      draftAction.params.sport === 'Футбол' &&
      Boolean(draftAction.params.date && draftAction.params.time && draftAction.params.address),
  );
  const cancelled = await localReply('отмена', filled.context, 'krasnoyarsk', local);
  check('«Отмена» прекращает создание', !cancelled.context?.pending);
  const nav = await localReply('Открой мои занятия', null, 'krasnoyarsk', local);
  check(
    'Просьба открыть страницу переходит на неё',
    nav.answer.action?.type === 'navigate' && nav.answer.action.params.path === '/me' && nav.answer.autoRun,
  );
  const join = await localReply(
    'Запиши меня на первую',
    { ...first.context!, cards: first.answer.cards },
    'krasnoyarsk',
    local,
  );
  check(
    'Запись на показанную встречу через подтверждение',
    join.answer.action?.type === 'join_event' &&
      join.answer.action.params.eventId === first.answer.cards?.[0]?.id,
  );
  const leave = await localReply('Отмени запись на волейбол', null, 'krasnoyarsk', local);
  check('Отмена записи через подтверждение', leave.answer.action?.type === 'leave_event');
  const companion = await localReply('Ищу компанию на пробежку по утрам', null, 'krasnoyarsk', local);
  check(
    'Объявление «Ищу компанию» собирается из фразы',
    companion.answer.action?.type === 'create_companion',
  );
  const beginner = await localReply('Я боюсь идти один. Как меня встретят?', null, 'krasnoyarsk', local);
  check(
    'Совет новичку ведёт к действующему фильтру',
    beginner.answer.links?.some(
      (l) => readFilters(new URL(l.to, 'http://local.test').searchParams).beginners,
    ),
  );
  const greeting = await chatReply('Привет, найди волейбол в выходные', null, 'krasnoyarsk', client);
  check('Приветствие не мешает настоящему поиску', Boolean(greeting.answer.cards?.length));
  check(
    'База знаний для модели совпадает с базой знаний сайта',
    readFileSync(new URL('../../../backend/app/assistant/knowledge.md', import.meta.url), 'utf8') ===
      render(),
  );
  const key = chatKey('u-anna', 'krasnoyarsk');
  const thread = newThread();
  thread.messages.push({ id: 'message', role: 'assistant', answer: first.answer });
  thread.context = first.context;
  check('История сохраняется в браузере', saveChats(key, [thread]));
  check(
    'После открытия возвращаются сообщения и условия',
    readChats(key)[0]?.messages[0]?.answer.cards?.[0]?.id === first.answer.cards?.[0]?.id &&
      readChats(key)[0]?.context?.filters.when === 'weekend',
  );
  check('Аккаунты не разделяют историю', !readChats(chatKey('u-dmitry', 'krasnoyarsk')).length);
  check('Города не разделяют историю', !readChats(chatKey('u-anna', 'moscow')).length);
  saveChats(key, Array.from({ length: 12 }, newThread));
  check('Число разговоров ограничено восемью', readChats(key).length === 8);
  storage.setItem(key, '{bad json');
  check('Повреждённая история не ломает открытие', readChats(key).length === 0);
  await assert.rejects(() =>
    chatReply('волейбол', null, 'krasnoyarsk', {
      ...client,
      match: async () => {
        throw new Error('Сервис недоступен');
      },
    }),
  );
  check('Сбой API возвращается интерфейсу для повтора и ручного поиска', true);
  process.stdout.write('Чат: все проверки прошли\n');
}
