/** Стопка заявок «По одной»: отложенная отправка решений, «Вернуть», порядок, ошибки, «Решу позже», места. */
import assert from 'node:assert/strict';

type Decision = { id: string; kind: 'accept' | 'reject'; reason?: string };

export async function main() {
  const { createDecisionQueue, UNDO_WINDOW_MS } = await import('@/pages/events/manage/review/decisionQueue');
  const model = await import('@/pages/events/manage/review/reviewModel');
  const { createDeck, decide, undo, currentKey } = await import('@/components/SwipeDeck/deck');
  const check = (name: string, ok: unknown) => {
    assert.ok(ok, name);
    process.stdout.write(`ок  ${name}\n`);
  };

  // Подменённые часы: таймеры срабатывают только при tick
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock = {
    set: (fn: () => void, ms: number) => {
      seq += 1;
      timers.set(seq, { at: now + ms, fn });
      return seq;
    },
    clear: (handle: unknown) => void timers.delete(handle as number),
  };
  const tick = async (ms: number) => {
    now += ms;
    for (const [id, t] of [...timers]) {
      if (t.at <= now) {
        timers.delete(id);
        t.fn();
      }
    }
    await new Promise((r) => setTimeout(r, 0));
  };

  const sent: string[] = [];
  const settled: { id: string; ok: boolean; code: string | null }[] = [];
  const failWith = new Map<string, { code: string; message: string }>();
  let slow: ((v?: unknown) => void) | null = null;
  const queue = createDecisionQueue<Decision>({
    clock,
    send: async (d) => {
      sent.push(`${d.id}:${d.kind}${d.reason ? `:${d.reason}` : ''}`);
      if (d.id === 'slow') await new Promise((r) => (slow = r));
      const error = failWith.get(d.id);
      if (error) throw Object.assign(new Error(error.message), error);
    },
    onSettled: (d, o) => settled.push({ id: d.id, ok: o.ok, code: o.ok ? null : o.code }),
  });

  check('Окно «Вернуть» — 5 секунд', UNDO_WINDOW_MS === 5000);

  queue.push({ id: 'a', kind: 'accept' });
  await tick(4999);
  check('Решение не уходит раньше 5 секунд', sent.length === 0 && queue.held()?.id === 'a');
  await tick(1);
  await queue.idle();
  check('Через 5 секунд решение отправлено', sent.join() === 'a:accept' && queue.held() === null);
  check('Итог отправки сообщён', settled.at(-1)?.id === 'a' && settled.at(-1)?.ok === true);

  queue.push({ id: 'b', kind: 'reject', reason: 'Все места распределены' });
  await tick(2000);
  const back = queue.undo('b');
  await tick(10_000);
  await queue.idle();
  check('«Вернуть» в окне отменяет решение без запроса', back?.id === 'b' && sent.length === 1);
  check(
    'Чужой id не отменяет ждущее решение',
    (queue.push({ id: 'c', kind: 'accept' }), queue.undo('x')) === null,
  );

  queue.push({ id: 'd', kind: 'reject' });
  await queue.idle();
  check(
    'Следующее решение отправляет предыдущее сразу',
    sent.at(-1) === 'c:accept' && queue.held()?.id === 'd',
  );
  await tick(5000);
  check('Отменить уже отправленное нельзя', queue.undo('d') === null);
  await queue.idle();

  queue.push({ id: 'e', kind: 'accept' });
  await queue.flush();
  check('Уход со страницы отправляет ждущее решение сразу', sent.at(-1) === 'e:accept' && !queue.held());
  const timersLeft = timers.size;
  check('После отправки таймер окна снят', timersLeft === 0);

  queue.push({ id: 'slow', kind: 'accept' });
  queue.push({ id: 'f', kind: 'reject' });
  void queue.flush();
  await new Promise((r) => setTimeout(r, 0));
  check('Пока предыдущий запрос не завершён, следующий ждёт', sent.at(-1) === 'slow:accept');
  (slow as unknown as () => void)();
  await queue.idle();
  check('Решения уходят строго по порядку', sent.slice(-2).join() === 'slow:accept,f:reject');

  failWith.set('g', { code: 'full', message: 'Мест не осталось' });
  failWith.set('h', { code: 'already_decided', message: 'Эта заявка уже рассмотрена' });
  queue.push({ id: 'g', kind: 'accept' });
  queue.push({ id: 'h', kind: 'reject' });
  await queue.flush();
  check(
    'Ошибка «мест нет» и «уже рассмотрена» приходят с кодом',
    settled.find((s) => s.id === 'g')?.code === 'full' &&
      settled.find((s) => s.id === 'h')?.code === 'already_decided',
  );
  check(
    'Ошибка одной отправки не останавливает очередь',
    settled.findIndex((s) => s.id === 'h') > settled.findIndex((s) => s.id === 'g'),
  );
  const before = sent.length;
  await queue.flush();
  check('Пустой flush ничего не отправляет', sent.length === before);

  // «Решу позже» и итог
  let s = { deck: createDeck(['a', 'b', 'c']), later: [] as string[] };
  s = model.applyDeckUpdate(s, (d) => decide(d, 'up', 'a'));
  check(
    '«Решу позже» отправляет карточку в конец',
    s.deck.order.join() === 'b,c,a' && s.later.join() === 'a',
  );
  check('Отложенная не считается решённой', s.deck.decisions.a === undefined && currentKey(s.deck) === 'b');
  s = model.applyDeckUpdate(s, (d) => decide(d, 'right', 'b'));
  s = model.appendKeys(s, ['n']);
  check('Новая заявка встаёт перед отложенными', s.deck.order.join() === 'b,c,n,a');
  s = model.applyDeckUpdate(s, (d) => decide(d, 'left', 'c'));
  check('Пока есть неразобранные, итога нет', !model.passDone(s));
  s = model.applyDeckUpdate(s, (d) => decide(d, 'up', 'n'));
  check('Остались только отложенные — итог', model.passDone(s) && s.later.join() === 'a,n');
  s = model.reopenLater(s);
  check('«Вернуться к отложенным» продолжает стопку', !model.passDone(s) && currentKey(s.deck) === 'a');
  let last = { deck: createDeck(['z']), later: [] as string[] };
  last = model.applyDeckUpdate(last, (d) => decide(d, 'up', 'z'));
  check('Единственную карточку некуда откладывать — сразу итог', model.passDone(last));

  const undone = undo(decide(createDeck(['a', 'b']), 'right'));
  check('«Вернуть» в стопке возвращает карточку наверх', undone !== null && currentKey(undone.state) === 'a');

  // Места
  const NBSP = String.fromCharCode(160);
  check('Принятые в стопке уменьшают свободные места', model.freeSeats(3, 2) === 1);
  check('Без лимита мест ограничения нет', model.acceptBlock(5, model.freeSeats(null, 3)) === null);
  check(
    'Не хватает мест — причина с числами',
    model.acceptBlock(3, 1) === 'Не хватает мест: нужно 3, свободно 1',
  );
  check('Хватает мест — принять можно', model.acceptBlock(2, 2) === null);
  check('Шапка: «Свободно 1 из 12»', model.seatsLine(12, 1) === 'Свободно 1 из 12');
  check(
    'Сводка в кабинете склоняется',
    model.pendingSummary(12, 3).replaceAll(NBSP, ' ') === 'Новые заявки: 12 по 3 событиям',
  );
  check(
    'Одно событие — «по 1 событию»',
    model.pendingSummary(2, 1).replaceAll(NBSP, ' ') === 'Новые заявки: 2 по 1 событию',
  );
  check(
    'Сообщение о решении без рода',
    model.decidedText('Анна Соколова', 'accept') === 'Анна Соколова: заявка принята',
  );
  check('Отозванная заявка', model.goneText('Иван Петров', 'cancelled') === 'Иван Петров: заявку отозвали');
}
