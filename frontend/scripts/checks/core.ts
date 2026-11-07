/** Форма создания встречи: перенос данных события в форму и обратно (pages/events/create/model). */
import assert from 'node:assert/strict';

import { makeEventDetails } from '../fixtures/event';

const memory = new Map<string, string>();
const storage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: (i: number) => [...memory.keys()][i] ?? null,
  get length() {
    return memory.size;
  },
};
Object.assign(globalThis, { localStorage: storage, sessionStorage: storage });

export async function main() {
  const { fromEvent, toInput, toPatch } = await import('@/pages/events/create/model');
  const check = (name: string, ok: unknown) => {
    assert.ok(ok, name);
    process.stdout.write(`ок  ${name}\n`);
  };

  const form = fromEvent(makeEventDetails());
  check(
    'Время события переведено в местное: 19:00 в Красноярске',
    form.date === '2030-06-15' && form.time === '19:00',
  );
  check('Направление и организатор-человек', form.sport?.id === 's-running' && form.orgId === null);
  check('Подсказка «как найти» берётся из ориентира', form.howToFind === 'У фонтана');

  const input = toInput(form, false);
  check('Время возвращается в UTC без сдвига', input.startsAt === '2030-06-15T12:00:00.000Z');
  check('Известное направление уходит по id', input.sportId === 's-running' && !('newSportName' in input));
  check('Цена и отмена переносятся', input.price.kind === 'free' && input.cancelPolicy.kind === 'anytime');
  check('Место переносится вместе с адресом', input.place.address === 'Татышев-парк, главный вход');
  check('Встреча по умолчанию публичная', input.visibility === 'public');

  const trimmed = toInput({ ...form, title: '  Пробежка  ', sport: null, newSportName: ' Лапта ' }, true);
  check('Название обрезается по краям', trimmed.title === 'Пробежка');
  check('Новое направление уходит названием', trimmed.newSportName === 'Лапта' && !('sportId' in trimmed));
  check('Пометка «создано с помощником» передаётся', trimmed.createdWithAssistant === true);

  const weekLater = fromEvent(makeEventDetails({ startsAt: '2030-06-22T12:00:00.000Z' }));
  check(
    'Копия на неделю вперёд: тот же час, дата +7',
    weekLater.date === '2030-06-22' && weekLater.time === '19:00',
  );

  const closed = toInput({ ...form, visibility: 'invite', title: 'Закрытая тренировка двора' }, false);
  check(
    'Закрытая встреча сохраняет вид и название',
    closed.visibility === 'invite' && closed.title === 'Закрытая тренировка двора',
  );
  const paid = toInput({ ...form, priceKind: 'fixed', priceAmount: 300 }, false);
  check('Платная встреча: сумма в цене', paid.price.kind === 'fixed' && paid.price.amount === 300);
  check(
    'Правка не меняет направление и организатора',
    !('sportId' in toPatch(form)) && !('orgId' in toPatch(form)),
  );
  process.stdout.write('Форма встречи: все проверки прошли\n');
}
