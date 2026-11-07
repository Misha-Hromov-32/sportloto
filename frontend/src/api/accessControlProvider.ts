import type { AccessControlProvider } from '@refinedev/core';

import { apiRequest } from './client';
import { session } from './session';

/**
 * Права для интерфейса: что показывать и что делать активным (`POST /api/access/can`).
 * Это подсказка экрану, а не защита: каждое действие сервер проверяет ещё раз.
 * Одинаковые вопросы за несколько секунд не повторяются — на странице их много.
 */

interface CanResult {
  can: boolean;
  reason?: string;
}

const TTL_MS = 3000;
const cache = new Map<string, { at: number; result: Promise<CanResult> }>();

session.subscribe(() => cache.clear());

export const accessControlProvider: AccessControlProvider = {
  can: async ({ resource, action, params }) => {
    // Из параметров Refine нужны только идентификаторы: в них же лежат описания ресурсов с функциями.
    const picked = { id: params?.id, orgId: params?.orgId, eventId: params?.eventId };
    const key = JSON.stringify([session.userId, resource, action, picked]);
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && now - hit.at < TTL_MS) return hit.result;
    const result = apiRequest<CanResult>('post', '/access/can', {
      body: { resource: resource ?? '', action, params: picked },
    }).catch(() => ({ can: true }));
    cache.set(key, { at: now, result });
    return result;
  },
  options: { buttons: { enableAccessControl: true, hideIfUnauthorized: false } },
};
