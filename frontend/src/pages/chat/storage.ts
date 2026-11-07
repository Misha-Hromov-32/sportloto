import { uid } from '@/lib/uid';
import type { ChatThread } from './model';

export const chatKey = (userId: string | null, cityId: string) =>
  `sportitochka.chat.v1:${userId ?? 'guest'}:${cityId}`;
export const newThread = (): ChatThread => ({
  id: uid(),
  title: 'Новый разговор',
  messages: [],
  context: null,
});
const bounded = (threads: ChatThread[]) =>
  threads.slice(0, 8).map((t) => ({ ...t, title: t.title.slice(0, 60), messages: t.messages.slice(-32) }));
export function readChats(key: string): ChatThread[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    return bounded(
      parsed
        .filter(
          (t): t is ChatThread =>
            t && typeof t.id === 'string' && typeof t.title === 'string' && Array.isArray(t.messages),
        )
        .map((t) => ({
          ...t,
          messages: t.messages.filter(
            (m) =>
              m &&
              (m.role === 'user' || m.role === 'assistant') &&
              typeof m.id === 'string' &&
              typeof m.answer?.text === 'string',
          ),
        })),
    );
  } catch {
    return [];
  }
}
export function saveChats(key: string, threads: ChatThread[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(bounded(threads)));
    return true;
  } catch {
    return false;
  }
}

/** The active conversation follows expansion/minimization within the same browser tab. */
export function readActiveChat(key: string, threads: ChatThread[]): string {
  try {
    const id = sessionStorage.getItem(`${key}:active`);
    if (threads.some((thread) => thread.id === id)) return id!;
  } catch {
    /* Storage can be unavailable in private browsing. */
  }
  return threads[0]!.id;
}

export function saveActiveChat(key: string, id: string): void {
  try {
    sessionStorage.setItem(`${key}:active`, id);
  } catch {
    /* The chat still works without storage. */
  }
}
