import { useEffect } from 'react';
import { useLocation } from 'react-router';

const SETTLE_MS = 3000;
const CHECK_MS = 150;
const STOP_EVENTS = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;

/**
 * Ссылка вида /settings#settings-messengers: разделы выше догружаются и сдвигают цель вниз,
 * поэтому, пока страница не устоялась, раздел возвращается к верху экрана. Первое действие человека
 * (прокрутка, касание, клавиша) это прекращает.
 */
export function useHashAnchor() {
  const { hash } = useLocation();

  useEffect(() => {
    const id = hash.slice(1);
    if (!id) return;
    let last = -1;
    const align = () => {
      const target = document.getElementById(id);
      if (!target) return;
      const top = Math.round(target.getBoundingClientRect().top + window.scrollY);
      if (top === last) return;
      last = top;
      target.scrollIntoView({ block: 'start' });
    };
    const stop = () => {
      window.clearInterval(timer);
      window.clearTimeout(limit);
      STOP_EVENTS.forEach((e) => window.removeEventListener(e, stop));
    };
    const timer = window.setInterval(align, CHECK_MS);
    const limit = window.setTimeout(stop, SETTLE_MS);
    STOP_EVENTS.forEach((e) => window.addEventListener(e, stop, { passive: true }));
    return stop;
  }, [hash]);
}
