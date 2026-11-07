import type { LiveEvent, LiveProvider } from '@refinedev/core';

import { API_URL } from './client';
import { session } from './session';

/**
 * Живые обновления по SSE (`GET /api/stream`): сервер сообщает, какие ресурсы изменились,
 * экраны перечитывают их со своими правами.
 * EventSource сам переподключается и присылает Last-Event-ID; если сервер не может дослать
 * пропущенное, приходит `resync` — тогда обновляем всё.
 */

/** Все каналы, которые слушают экраны: для `resync` и для смены пользователя. */
export const RESOURCES = [
  'events',
  'participations',
  'messages',
  'organizations',
  'companions',
  'notifications',
  'sports',
  'users',
  'audit',
  'invites',
  'admin',
  'demo',
  'inventory',
  'demand',
  'venues',
  'imports',
  'reports',
  'mcp',
] as const;

type Listener = (event: LiveEvent) => void;

interface WireEvent {
  channel: string;
  type: string;
  payload: LiveEvent['payload'];
  date: string;
}

const listeners = new Set<Listener>();
let source: EventSource | null = null;
let sourceToken: string | null = null;

function deliver(event: LiveEvent) {
  for (const listener of [...listeners]) listener(event);
}

/** Сообщить экранам вкладки, что ресурсы изменились (вход, выход, перечитать всё). */
export function emitLocal(resources: readonly string[] = RESOURCES, ids: string[] = []) {
  const date = new Date();
  for (const resource of resources) {
    deliver({ channel: `resources/${resource}`, type: 'updated', payload: { ids }, date });
  }
}

function connect() {
  if (typeof EventSource === 'undefined') return;
  const token = session.token;
  if (source && sourceToken === token) return;
  source?.close();
  sourceToken = token;
  source = new EventSource(`${API_URL}/stream${token ? `?access_token=${encodeURIComponent(token)}` : ''}`);
  source.addEventListener('live', (message) => {
    try {
      const data = JSON.parse((message as MessageEvent<string>).data) as WireEvent;
      deliver({ channel: data.channel, type: data.type, payload: data.payload, date: new Date(data.date) });
    } catch {
      /* битое событие пропускаем: следующее придёт целым */
    }
  });
  source.addEventListener('resync', () => emitLocal());
}

// Вошли или вышли — личный канал другой: переподключаемся.
session.subscribe(() => {
  if (source) connect();
});

// Вкладка была в фоне: браузер мог придержать соединение (без HTTP/2 их не больше шести на сайт),
// и события вроде допуска организации не дошли. Вернулись — перечитываем экран и проверяем поток.
const STALE_AFTER_MS = 10_000;
let hiddenAt: number | null = null;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (!source) return;
    if (source.readyState === EventSource.CLOSED) {
      source = null;
      connect();
    }
    if (away >= STALE_AFTER_MS) emitLocal();
  });
}

export const liveProvider: LiveProvider = {
  subscribe: ({ channel, types, callback }) => {
    const listener: Listener = (event) => {
      if (channel !== 'resources/*' && event.channel !== channel) return;
      if (!types.includes('*') && !types.includes(event.type)) return;
      callback(event);
    };
    listeners.add(listener);
    connect();
    return () => listeners.delete(listener);
  },
  unsubscribe: (unsubscribe: () => void) => {
    unsubscribe();
  },
  publish: () => {
    /* события публикует только сервер */
  },
};
