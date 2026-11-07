/** Стопка «По одной»: порог свайпа, фиксация направления, «Вернуть», отложенные и живые обновления. */
import assert from 'node:assert/strict';

export async function main() {
  const deck = await import('@/components/SwipeDeck/deck');
  const { createDeck, decide, undo, restore, drop, postpone, keysWith, currentKey, remaining, isDone } = deck;
  const check = (name: string, ok: unknown) => {
    assert.ok(ok, name);
    process.stdout.write(`ок  ${name}\n`);
  };

  const width = 400;
  check('Меньше 35% ширины без взмаха — карточка возвращается', deck.swipeOutcome(130, width, 0.1) === null);
  check('Дальше 35% вправо — «да»', deck.swipeOutcome(141, width, 0) === 'right');
  check('Дальше 35% влево — «нет»', deck.swipeOutcome(-141, width, 0) === 'left');
  check(
    'Резкий взмах быстрее 0,5 px/мс срабатывает и на коротком пути',
    deck.swipeOutcome(40, width, 0.8) === 'right',
  );
  check('Взмах против направления сдвига не срабатывает', deck.swipeOutcome(40, width, -0.8) === null);
  check('Дрожание пальца меньше 8 px не считается взмахом', deck.swipeOutcome(5, width, 2) === null);
  check('Направление не фиксируется до 8 px', deck.axisLock(5, 6) === null);
  check('Горизонтальное движение — свайп', deck.axisLock(12, 4) === 'x');
  check('Вертикальное движение — прокрутка, не свайп', deck.axisLock(3, 14) === 'y');
  check(
    'Поворот не больше 12°',
    deck.dragRotation(10_000, width) === 12 && deck.dragRotation(-10_000, width) === -12,
  );
  check(
    'Штамп в полную силу на пороге',
    deck.dragProgress(140, width) === 1 && deck.dragProgress(70, width) === 0.5,
  );
  check(
    'Скорость взмаха по последним 100 мс',
    deck.releaseVelocity(
      deck.recentSamples(
        [
          { x: 0, t: 0 },
          { x: 10, t: 200 },
          { x: 70, t: 300 },
        ],
        300,
      ),
    ) === 0.6,
  );

  let s = createDeck(['a', 'b', 'c', 'b']);
  check('Повторы в стопке не дублируются', s.order.join() === 'a,b,c');
  check('Счётчик «1 из 3»', deck.progressLabel(s) === '1 из 3');
  s = decide(s, 'right');
  check(
    'После «Хочу пойти» следующая карточка и «2 из 3»',
    currentKey(s) === 'b' && deck.progressLabel(s) === '2 из 3',
  );
  check('Чужой ключ не решается мимо текущей карточки', decide(s, 'left', 'c') === s);
  s = decide(s, 'left');
  const back = undo(s);
  check(
    '«Вернуть» возвращает последнюю карточку',
    back !== null && currentKey(back.state) === 'b' && back.dir === 'left',
  );
  check('Возврат снимает решение', back !== null && back.state.decisions.b === undefined);
  check('Возврат только на одну глубину', back !== null && undo(back.state) === null);
  s = back!.state;
  s = decide(s, 'right');
  s = decide(s, 'up');
  check('Стопка закончилась', isDone(s) && remaining(s) === 0);
  check('Отложенные — только «Хочу пойти»', keysWith(s, 'right').join() === 'a,b');
  check('Записанные считаются отдельно', keysWith(s, 'up').join() === 'c');
  check('Подсказка клавиш прячется после трёх действий', s.actions >= deck.SWIPE.hintActions);

  let r = decide(createDeck(['a', 'b', 'c']), 'right');
  r = decide(r, 'left');
  r = restore(r, 'a');
  check(
    'Неудачное сохранение возвращает карточку наверх',
    currentKey(r) === 'a' && r.decisions.a === undefined,
  );
  check(
    'После возврата неудачной карточки решения других целы',
    r.decisions.b === 'left' && remaining(r) === 2,
  );

  let live = decide(createDeck(['a', 'b', 'c', 'd']), 'right');
  live = drop(live, ['a', 'c']);
  check(
    'Отменённое событие уходит из стопки и из отложенных',
    !live.order.includes('a') && keysWith(live, 'right').length === 0,
  );
  check(
    'Позиция не сбивается, когда уходит уже просмотренная карточка',
    currentKey(live) === 'b' && live.index === 0,
  );
  check('«Вернуть» недоступно для ушедшей карточки', live.last === null);

  let later = postpone(createDeck(['a', 'b', 'c']));
  check(
    '«Решу позже» отправляет карточку в конец',
    later.order.join() === 'b,c,a' && currentKey(later) === 'b',
  );
  later = postpone(decide(decide(later, 'right'), 'right'));
  check('Последнюю карточку некуда откладывать', later.order.join() === 'b,c,a' && currentKey(later) === 'a');

  const json = JSON.parse(JSON.stringify(decide(createDeck(['a', 'b']), 'right')));
  check(
    'Состояние переживает сохранение во вкладке',
    currentKey(json) === 'b' && json.decisions.a === 'right',
  );
}
