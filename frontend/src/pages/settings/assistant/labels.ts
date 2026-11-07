import type { StatusMeta } from '@/lib/labels';
import type { McpCallView, McpScope, McpTokenStatus } from '@/types/mcp';

export const TOKEN_STATUS: Record<McpTokenStatus, StatusMeta> = {
  active: { label: 'Действует', tone: 'ok', icon: 'check' },
  expired: { label: 'Срок истёк', tone: 'off', icon: 'history' },
  revoked: { label: 'Отозван', tone: 'off', icon: 'ban' },
};

export const SCOPE_SHORT: Record<McpScope, string> = {
  read: 'Смотреть',
  participate: 'Записываться',
  drafts: 'Черновики',
};

const CALL_ERROR: Record<string, string> = {
  forbidden_scope: 'Не хватило прав',
  rate_limit: 'Слишком часто',
  revoked: 'Токен отозван',
  expired: 'Срок токена истёк',
  validation: 'Ошибка в данных',
  unknown_tool: 'Нет такого инструмента',
  unknown_resource: 'Нет такого материала',
  method_not_found: 'Неизвестный метод',
  internal: 'Сбой',
};

export function callStatus(c: Pick<McpCallView, 'ok' | 'preview' | 'error'>): StatusMeta {
  if (c.ok && c.preview) return { label: 'Только предпросмотр', tone: 'wait', icon: 'clock' };
  if (c.ok) return { label: 'Выполнено', tone: 'ok', icon: 'check' };
  return { label: CALL_ERROR[c.error ?? ''] ?? 'Не выполнено', tone: 'danger', icon: 'cross' };
}

export const EXPIRY_LABEL: Record<number, string> = {
  30: '30 дней',
  90: '90 дней',
  365: '1 год',
};
