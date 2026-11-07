import type { DataProvider } from '@refinedev/core';

import { API_URL, apiRequest } from './client';

/**
 * HTTP-провайдер Refine для бэкенда. Ресурсы и действия совпадают с контрактом
 * docs/architecture/api.md: список — `GET /api/<ресурс>` с фильтрами, сортировкой и страницами
 * Refine (JSON в параметрах) и ответом `{ data, total }`, карточка — `GET /api/<ресурс>/<id>`,
 * действия — по своим адресам (`POST /api/events/:id/join` и т. п.).
 */

const path = (...parts: (string | number)[]) =>
  parts.map((p) => `/${encodeURIComponent(String(p))}`).join('');

/** Адрес действия без префикса /api и строка запроса отдельно. */
function splitUrl(url: string): { path: string; query: Record<string, string> } {
  const relative = url.startsWith(API_URL) ? url.slice(API_URL.length) : url;
  const [pathname = '', search = ''] = relative.split('?');
  return {
    path: pathname.startsWith('/') ? pathname : `/${pathname}`,
    query: Object.fromEntries(new URLSearchParams(search)),
  };
}

export const dataProvider: DataProvider = {
  getApiUrl: () => API_URL,

  getList: async ({ resource, filters, sorters, pagination }) => {
    const result = await apiRequest<{ data: never[]; total: number }>('get', path(resource), {
      query: { filters: filters ?? [], sorters: sorters ?? [], pagination: pagination ?? {} },
    });
    return { data: result.data, total: result.total };
  },

  getOne: async ({ resource, id, meta }) => {
    // С13: код из ссылки-приглашения открывает закрытую встречу
    const invite = typeof meta?.invite === 'string' && meta.invite ? meta.invite : null;
    const data = await apiRequest<never>('get', path(resource, id), {
      query: invite ? { meta: { invite } } : undefined,
    });
    return { data };
  },

  getMany: async ({ resource, ids }) => {
    const data = await apiRequest<never[]>('get', path('_many', resource), {
      query: { ids: ids.map(String).join(',') },
    });
    return { data };
  },

  create: async ({ resource, variables }) => ({
    data: await apiRequest<never>('post', path(resource), { body: variables ?? {} }),
  }),

  update: async ({ resource, id, variables }) => ({
    data: await apiRequest<never>('put', path(resource, id), { body: variables ?? {} }),
  }),

  deleteOne: async ({ resource, id }) => ({
    data: await apiRequest<never>('delete', path(resource, id)),
  }),

  custom: async ({ url, method, payload, query }) => {
    const target = splitUrl(url);
    const data = await apiRequest<never>(method, target.path, {
      body: method === 'get' ? undefined : (payload ?? {}),
      query: { ...target.query, ...((query as Record<string, unknown> | undefined) ?? {}) },
    });
    return { data };
  },
};
