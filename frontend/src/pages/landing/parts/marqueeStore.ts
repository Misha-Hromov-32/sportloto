import { useSyncExternalStore } from 'react';

/**
 * Пауза всего, что движется на главной само: ленты фото, бегущей строки видов спорта, лент вопросов
 * и покачивания значков на фоне. На телефоне наведения нет, поэтому останавливают кнопкой.
 * Кнопок несколько (у ленты фото и у вопросов), состояние у них общее.
 */
let paused = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const listeners = new Set<() => void>();

function apply() {
  document.documentElement.toggleAttribute('data-marquee-paused', paused);
}

export function setMarqueePaused(next: boolean) {
  paused = next;
  apply();
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  if (!listeners.size) apply();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) document.documentElement.removeAttribute('data-marquee-paused');
  };
}

export function useMarqueePaused() {
  return useSyncExternalStore(
    subscribe,
    () => paused,
    () => false,
  );
}
