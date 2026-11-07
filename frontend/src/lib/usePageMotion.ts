import { useLayoutEffect, type RefObject } from 'react';

/**
 * Появление блоков при прокрутке: каждая секция, карточка и группа плавно поднимается, когда до неё
 * долистали; соседние карточки одного ряда появляются по очереди.
 *
 * Скрываются только блоки ниже первого экрана (`data-entry-motion="ready"`, см. theme/motion.css) —
 * без скрипта, при уменьшении движения, в простом режиме и при печати всё видно сразу.
 * Варианты через `data-reveal`: `title` (заголовок, выше подъём), `media` (фото, лёгкое увеличение),
 * `side` (выезд слева). `data-stagger` у контейнера — его дети появляются по очереди.
 */

const TARGETS = [
  '[data-reveal]',
  '[data-stagger] > *',
  '[data-motion-key]',
  'section',
  'article',
  ':scope > div > :is(header, aside, form)',
  ':scope > div > div > :is(header, aside, form)',
].join(', ');
const EXCLUDED =
  '[aria-hidden="true"], [hidden], [role="status"], .sr-only, .leaflet-container, [data-motion="off"]';
const EASE = 'cubic-bezier(0.16, 1, 0.3, 1)';
const STAGGER_MS = 90;
const MAX_DELAY_MS = 450;

const still = () =>
  matchMedia('(prefers-reduced-motion: reduce)').matches ||
  document.documentElement.hasAttribute('data-simple');

function keyframes(node: HTMLElement, fromAbove: boolean, pinned: boolean): Keyframe[] {
  if (pinned) return [{ opacity: 0 }, { opacity: 1 }];
  const variant = node.dataset.reveal;
  if (variant === 'media')
    return [
      { opacity: 0, translate: fromAbove ? '0 0' : '0 40px', scale: '0.96' },
      { opacity: 1, translate: '0 0', scale: '1' },
    ];
  if (variant === 'side')
    return [
      { opacity: 0, translate: '-28px 0' },
      { opacity: 1, translate: '0 0' },
    ];
  const distance = variant === 'title' ? 44 : 32;
  return [
    { opacity: 0, translate: fromAbove ? '0 0' : `0 ${distance}px` },
    { opacity: 1, translate: '0 0' },
  ];
}

export function usePageMotion(rootRef: RefObject<HTMLElement | null>, pathname: string) {
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root || !('IntersectionObserver' in window) || !('animate' in HTMLElement.prototype)) return;
    const seen = new WeakSet<HTMLElement>();
    const pending = new Set<HTMLElement>();
    const active = new Map<HTMLElement, Animation>();
    let frame = 0;

    const cancel = (node: HTMLElement) => {
      active.get(node)?.cancel();
      active.delete(node);
    };
    const reveal = (node: HTMLElement, delay = 0) => {
      pending.delete(node);
      observer.unobserve(node);
      node.dataset.entryMotion = 'shown';
      if (still() || document.hidden || !node.getClientRects().length) return;
      // Фокус и переход по якорю не ждут анимации.
      if (node.contains(document.activeElement) || node.matches(':target') || node.querySelector(':target'))
        return;
      const rect = node.getBoundingClientRect();
      if (rect.bottom <= 0) return;
      // Закреплённое содержимое не сдвигаем: у него сменился бы блок, относительно которого оно стоит.
      const pinned = [node, ...node.querySelectorAll<HTMLElement>('*')].some((el) =>
        ['fixed', 'sticky'].includes(getComputedStyle(el).position),
      );
      const variant = node.dataset.reveal;
      const animation = node.animate(keyframes(node, rect.top < 0, pinned), {
        duration: variant === 'media' ? 1000 : variant === 'title' ? 900 : 800,
        delay,
        easing: EASE,
        fill: 'backwards',
      });
      active.set(node, animation);
      const done = () => {
        if (active.get(node) === animation) active.delete(node);
      };
      void animation.finished.then(done, done);
    };
    const enter = (visible: HTMLElement[]) => {
      // Ряд появляется целиком: карточки карусели, ушедшие вбок за край, браузер «видимыми» не считает.
      const nodes = [...visible];
      for (const node of visible) {
        const row = node.parentElement;
        if (!row?.hasAttribute('data-stagger')) continue;
        for (const sibling of row.children)
          if (sibling instanceof HTMLElement && pending.has(sibling) && !nodes.includes(sibling))
            nodes.push(sibling);
      }
      // Соседи одного ряда (общий родитель или общий data-stagger) появляются по очереди.
      const order = new Map<Element, number>();
      for (const node of nodes) {
        const group = node.parentElement?.closest('[data-stagger]') ?? node.parentElement ?? root;
        const index = order.get(group) ?? 0;
        order.set(group, index + 1);
        const requested = Number(node.dataset.motionDelay ?? 0);
        reveal(node, Math.min(Math.max(0, requested) + index * STAGGER_MS, MAX_DELAY_MS));
      }
    };
    const observer = new IntersectionObserver(
      (entries) => enter(entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement)),
      { threshold: 0, rootMargin: '0px 0px -8% 0px' },
    );

    const scan = () => {
      frame = 0;
      const candidates = [...root.querySelectorAll<HTMLElement>(TARGETS)].filter(
        (node) => !node.closest(EXCLUDED) && node.getClientRects().length,
      );
      const atomic = candidates.filter(
        (node) =>
          node.hasAttribute('data-reveal') ||
          node.parentElement?.hasAttribute('data-stagger') ||
          (node.hasAttribute('data-motion-key') && node.getAttribute('role') !== 'tabpanel'),
      );
      // Анимируем самые мелкие смысловые группы: секцию — только если внутри нет своих карточек.
      const nodes = candidates.filter((node) => {
        if (atomic.some((parent) => parent !== node && parent.contains(node))) return false;
        if (atomic.includes(node)) return true;
        return !candidates.some((child) => child !== node && node.contains(child));
      });
      const viewport = root.getBoundingClientRect();
      const immediate: HTMLElement[] = [];
      for (const node of nodes) {
        if (seen.has(node)) continue;
        seen.add(node);
        const rect = node.getBoundingClientRect();
        if (still() || rect.bottom < 0) {
          node.dataset.entryMotion = 'shown';
          continue;
        }
        if (rect.top < Math.min(innerHeight, viewport.bottom) && rect.bottom > Math.max(0, viewport.top)) {
          node.dataset.entryMotion = 'shown';
          immediate.push(node);
        } else {
          node.dataset.entryMotion = 'ready';
          pending.add(node);
          observer.observe(node);
        }
      }
      enter(immediate);
      const selected = new Set(nodes);
      for (const node of pending)
        if (!root.contains(node) || !selected.has(node)) {
          observer.unobserve(node);
          pending.delete(node);
          node.dataset.entryMotion = 'shown';
        }
      for (const node of active.keys()) if (!root.contains(node) || !selected.has(node)) cancel(node);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(scan);
    };
    const mutations = new MutationObserver((records) => {
      for (const record of records) {
        if (
          record.type === 'attributes' &&
          record.attributeName === 'data-motion-key' &&
          record.target instanceof HTMLElement
        ) {
          // Сменился шаг мастера или вкладка — новое содержимое тоже появляется.
          const node = record.target;
          cancel(node);
          seen.delete(node);
          for (const child of node.querySelectorAll<HTMLElement>(TARGETS)) {
            cancel(child);
            seen.delete(child);
          }
        }
      }
      schedule();
    });
    mutations.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden', 'aria-hidden', 'data-motion-key'],
    });
    const preference = () => {
      if (still() || document.hidden) {
        for (const node of active.keys()) cancel(node);
        for (const node of [...pending]) reveal(node);
      } else schedule();
    };
    const settings = new MutationObserver(preference);
    settings.observe(document.documentElement, { attributes: true, attributeFilter: ['data-simple'] });
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const focus = (event: FocusEvent) => {
      if (!(event.target instanceof Node)) return;
      for (const node of active.keys()) if (node.contains(event.target)) cancel(node);
      for (const node of [...pending]) if (node.contains(event.target)) reveal(node);
    };
    // Печать и переход к якорю: всё скрытое показываем сразу.
    const showAll = () => {
      for (const node of [...pending]) reveal(node);
    };
    // Дошли до конца страницы — нижним блокам уже некуда «въезжать», показываем оставшееся.
    const atEnd = () => {
      if (pending.size && innerHeight + scrollY >= document.documentElement.scrollHeight - 4)
        enter([...pending].filter((node) => node.getBoundingClientRect().top < innerHeight));
    };
    root.addEventListener('focusin', focus);
    reduced.addEventListener('change', preference);
    document.addEventListener('visibilitychange', preference);
    window.addEventListener('beforeprint', showAll);
    window.addEventListener('hashchange', showAll);
    window.addEventListener('resize', schedule, { passive: true });
    window.addEventListener('scroll', atEnd, { passive: true });
    scan();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      mutations.disconnect();
      settings.disconnect();
      root.removeEventListener('focusin', focus);
      reduced.removeEventListener('change', preference);
      document.removeEventListener('visibilitychange', preference);
      window.removeEventListener('beforeprint', showAll);
      window.removeEventListener('hashchange', showAll);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', atEnd);
      for (const node of active.keys()) cancel(node);
      for (const node of pending) node.dataset.entryMotion = 'shown';
    };
  }, [rootRef, pathname]);
}
