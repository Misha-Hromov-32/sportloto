import type { DeckState } from '@/components/SwipeDeck/deck';

const DECK_KEY = 'sportitochka.deck.events';
const SAVED_KEY = 'sportitochka.deck.saved';

function read<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* хранилище недоступно: позиция живёт до перезагрузки */
  }
}

/** Позиция в стопке помнится в этой вкладке, пока не поменялись город, фильтры и порядок. */
export function loadDeck(signature: string): DeckState | null {
  const saved = read<{ signature: string; deck: DeckState }>(DECK_KEY);
  if (!saved || saved.signature !== signature || !Array.isArray(saved.deck?.order)) return null;
  return saved.deck;
}

export function saveDeck(signature: string, deck: DeckState | null) {
  write(DECK_KEY, deck ? { signature, deck } : null);
}

/** Отложенное гостем: только в этой вкладке, после входа переносится в избранное. */
export function guestSaved(): string[] {
  const ids = read<string[]>(SAVED_KEY);
  return Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
}

export function setGuestSaved(id: string, on: boolean) {
  const ids = guestSaved().filter((x) => x !== id);
  if (on) ids.push(id);
  write(SAVED_KEY, ids.length ? ids : null);
}

export function clearGuestSaved() {
  write(SAVED_KEY, null);
}
