import assert from 'node:assert/strict';

export async function main() {
  const { assistantReturnTo } = await import('@/pages/chat/navigation');
  const { readActiveChat, saveActiveChat, newThread } = await import('@/pages/chat/storage');
  const check = (name: string, ok: unknown) => {
    assert.ok(ok, name);
    process.stdout.write(`ок  ${name}\n`);
  };
  const origin = '/events?phrase=бег&view=cards#nearby';
  check(
    'Возврат сохраняет фильтры и якорь исходной страницы',
    decodeURI(assistantReturnTo({ assistantReturnTo: origin })) === origin,
  );
  for (const value of [
    undefined,
    null,
    {},
    { assistantReturnTo: 123 },
    ...[
      '//elsewhere.test',
      'https://elsewhere.test',
      '/\\elsewhere.test',
      '/assistant',
      '/assistant/?a=1',
      '/events/../assistant',
    ].map((assistantReturnTo) => ({ assistantReturnTo })),
  ]) {
    assert.equal(assistantReturnTo(value), '/events');
  }
  check('Прямая ссылка, внешние адреса и возврат в сам чат ведут в каталог', true);
  const memory = new Map<string, string>();
  Object.assign(globalThis, {
    sessionStorage: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
    },
  });
  const chats = [newThread(), newThread()];
  saveActiveChat('guest:city', chats[1]!.id);
  check(
    'Разворачивание и сворачивание сохраняют выбранный разговор',
    readActiveChat('guest:city', chats) === chats[1]!.id,
  );
  check(
    'Активный разговор отделён для другого человека или города',
    readActiveChat('user:city', chats) === chats[0]!.id,
  );
  check(
    'После удаления разговора выбирается существующий',
    readActiveChat('guest:city', [chats[0]!]) === chats[0]!.id,
  );
}
