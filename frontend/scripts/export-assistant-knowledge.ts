/**
 * База знаний чат-бота для модели: frontend/src/pages/chat/knowledge.ts → backend/app/assistant/knowledge.md.
 * Запуск: node scripts/run-ts.mjs scripts/export-assistant-knowledge.ts [--check]
 * С --check только сверяет: файл на сервере должен совпадать с базой знаний сайта.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { KNOWLEDGE, SITE_MAP } from '@/pages/chat/knowledge';

const ROLE: Record<string, string> = {
  guest: 'гость',
  user: 'участник',
  organizer: 'организатор',
  admin: 'администратор',
};
const ACTION: Record<string, string> = {
  navigate: 'navigate',
  search_events: 'поле search',
  create_event: 'create_event',
  join_event: 'join_event',
  leave_event: 'leave_event',
  create_companion: 'create_companion',
  favorite_event: 'favorite_event',
  update_profile: 'update_profile',
};

export function render(): string {
  const roles = (r?: string[]) => (r?.length ? ` (для: ${r.map((x) => ROLE[x] ?? x).join(', ')})` : '');
  const lines = [
    '<!-- Собрано из frontend/src/pages/chat/knowledge.ts скриптом frontend/scripts/export-assistant-knowledge.ts. Не править вручную. -->',
    '',
    '## Страницы сайта',
    '',
    ...SITE_MAP.map((p) => `- \`${p.path}\` — ${p.title}${roles(p.roles)}: ${p.what}`),
    '',
    '## Как что сделать',
    '',
  ];
  for (const t of KNOWLEDGE) {
    lines.push(`### ${t.title}${roles(t.roles)}`, '', t.answer, '');
    t.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    lines.push('', `Ссылки: ${t.links.map((l) => `${l.label} → \`${l.to}\``).join('; ')}`);
    if (t.action) lines.push(`Помощник может сделать сам: ${ACTION[t.action] ?? t.action}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function main(args: string[]) {
  const target = path.resolve(process.cwd(), '../backend/app/assistant/knowledge.md');
  const text = render();
  if (args.includes('--check')) {
    const same = existsSync(target) && readFileSync(target, 'utf8') === text;
    const verdict = same
      ? 'knowledge.md совпадает с базой знаний'
      : 'knowledge.md устарел: запустите без --check';
    process.stdout.write(`${verdict}\n`);
    return same ? 0 : 1;
  }
  writeFileSync(target, text);
  process.stdout.write(`Записано ${KNOWLEDGE.length} тем и ${SITE_MAP.length} страниц в ${target}\n`);
  return 0;
}
