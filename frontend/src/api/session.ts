/**
 * Сессия входа на сервере. Токен хранится отдельно в каждой вкладке (sessionStorage), чтобы в двух
 * вкладках можно было держать разных пользователей: организатора и участника. Новая вкладка берёт
 * последний вход из localStorage. Запросы передают токен в заголовке Authorization.
 */
const TAB_KEY = 'vmeste.api.session';
const LAST_KEY = 'vmeste.api.lastSession';

interface Stored {
  token: string;
  userId: string;
}

function safeGet(storage: Storage, key: string): Stored | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<Stored>;
    return typeof value.token === 'string' && typeof value.userId === 'string'
      ? { token: value.token, userId: value.userId }
      : null;
  } catch {
    return null;
  }
}

function safeSet(storage: Storage, key: string, value: Stored | null) {
  try {
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(value));
  } catch {
    /* хранилище недоступно (приватный режим) — сессия живёт до перезагрузки */
  }
}

let memory: Stored | null | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function current(): Stored | null {
  if (memory === undefined) memory = safeGet(sessionStorage, TAB_KEY) ?? safeGet(localStorage, LAST_KEY);
  return memory;
}

export const session = {
  get token(): string | null {
    return current()?.token ?? null;
  },
  get userId(): string | null {
    return current()?.userId ?? null;
  },
  set(token: string, userId: string) {
    memory = { token, userId };
    safeSet(sessionStorage, TAB_KEY, memory);
    safeSet(localStorage, LAST_KEY, memory);
    emit();
  },
  clear() {
    const was = current();
    memory = null;
    safeSet(sessionStorage, TAB_KEY, null);
    // Последний вход забываем, только если это он: другая вкладка могла уже войти под другим именем.
    if (was && safeGet(localStorage, LAST_KEY)?.token === was.token) safeSet(localStorage, LAST_KEY, null);
    emit();
  },
  /** Подписка на вход и выход — для настроек внешнего вида и переподключения живых обновлений. */
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getUserId(): string | null {
    return session.userId;
  },
};
