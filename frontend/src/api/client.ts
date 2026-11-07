import type { HttpError } from '@refinedev/core';

import { selectedCityId } from '@/lib/cities';

import { session } from './session';

/** Адрес API: в разработке Vite проксирует /api на бэкенд, в Docker — nginx. */
export const API_URL = '/api';

/**
 * Ошибка API: код для логики и готовое русское сообщение для человека.
 * Совместима с HttpError Refine; дополнительные поля ответа (`similar`, `fallback`, `conflicts`) — на объекте.
 */
export class ApiError extends Error implements HttpError {
  readonly code: string;
  readonly statusCode: number;
  readonly errors?: Record<string, string>;
  [key: string]: unknown;

  constructor(body: Record<string, unknown>, statusCode: number) {
    super(
      typeof body.message === 'string' && body.message ? body.message : 'Не получилось. Попробуйте ещё раз',
    );
    Object.assign(this, body);
    this.name = 'ApiError';
    this.code = typeof body.code === 'string' ? body.code : 'internal';
    this.statusCode = statusCode;
    if (body.errors && typeof body.errors === 'object') this.errors = body.errors as Record<string, string>;
  }
}

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options';

export interface RequestOptions {
  body?: unknown;
  /** Параметры адреса: строки как есть, остальное — JSON. */
  query?: Record<string, unknown>;
  signal?: AbortSignal;
}

function buildUrl(path: string, query?: Record<string, unknown>): string {
  const url = new URL(`${API_URL}${path}`, window.location.origin);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null) continue;
    url.searchParams.set(
      key,
      typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value),
    );
  }
  return `${url.pathname}${url.search}`;
}

export async function apiRequest<T = unknown>(
  method: Method,
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', 'X-City': selectedCityId() };
  const token = session.token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const hasBody = opts.body !== undefined && method !== 'get' && method !== 'head';
  if (hasBody) headers['Content-Type'] = 'application/json';

  let response: Response;
  try {
    response = await fetch(buildUrl(path, opts.query), {
      method: method.toUpperCase(),
      headers,
      body: hasBody ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      signal: opts.signal,
    });
  } catch {
    if (opts.signal?.aborted)
      throw new ApiError(
        { code: 'timeout', message: 'Время ожидания ответа истекло. Попробуйте ещё раз.' },
        0,
      );
    throw new ApiError(
      { code: 'network', message: 'Нет связи с сервером. Проверьте интернет и попробуйте ещё раз' },
      0,
    );
  }
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const body =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {
            code: response.status >= 500 ? 'internal' : 'bad_request',
            message: 'Сервер не ответил. Попробуйте ещё раз',
          };
    throw new ApiError(body, response.status);
  }
  return data as T;
}
