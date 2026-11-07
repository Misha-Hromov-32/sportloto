import { useEffect } from 'react';
import { useLocation } from 'react-router';
import { useSelectedCity } from './useSelectedCity';

/**
 * Заголовок вкладки и мета-теги при переходах внутри SPA. Первую загрузку размечает сервер
 * (nginx вставляет ответ /api/seo/head в index.html), здесь — те же данные для следующих страниц.
 * Без сервера (автономная сборка) заголовок вкладки ставит DocumentTitleHandler в App.tsx.
 */

interface PageMeta {
  title: string;
  description?: string;
  canonical?: string | null;
  robots?: string;
  image?: string;
  ogType?: string;
  jsonld?: unknown[];
}

const SITE = 'Спорт и точка';

function setMeta(attr: 'name' | 'property', key: string, value: string | undefined) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!value) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
}

function setCanonical(href: string | null | undefined) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!href) {
    el?.remove();
    return;
  }
  if (!el) {
    el = document.createElement('link');
    el.rel = 'canonical';
    document.head.appendChild(el);
  }
  el.href = href;
}

function apply(meta: PageMeta, pathname: string) {
  // На главной заголовок вкладки называет выбранный город — его ставит DocumentTitleHandler.
  if (pathname !== '/') document.title = meta.title;
  if (!meta.description) return;
  setMeta('name', 'description', meta.description);
  setMeta('name', 'robots', meta.robots);
  setCanonical(meta.canonical);
  setMeta('property', 'og:title', meta.title.replace(` — ${SITE}`, ''));
  setMeta('property', 'og:description', meta.description);
  setMeta('property', 'og:type', meta.ogType);
  setMeta('property', 'og:image', meta.image);
  setMeta('property', 'og:url', meta.canonical ?? undefined);
  document.head.querySelectorAll('script[type="application/ld+json"]').forEach((el) => el.remove());
  for (const item of meta.jsonld ?? []) {
    const el = document.createElement('script');
    el.type = 'application/ld+json';
    el.textContent = JSON.stringify(item);
    document.head.appendChild(el);
  }
}

/** Подключается один раз внутри роутера. */
export function SeoSync() {
  const { pathname } = useLocation();
  const city = useSelectedCity();
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/seo/meta?path=${encodeURIComponent(pathname)}`, { signal: controller.signal })
      .then((res) =>
        res.ok ? (res.json() as Promise<PageMeta>) : Promise.reject(new Error(String(res.status))),
      )
      .then((meta) =>
        apply(
          pathname === '/events' ? { ...meta, title: `События и тренировки в ${city.in} — ${SITE}` } : meta,
          pathname,
        ),
      )
      // Без ответа сервера остаются заголовок из DocumentTitleHandler и мета первой загрузки.
      .catch(() => undefined);
    return () => controller.abort();
  }, [pathname, city.in]);
  return null;
}
