import { useCustom, type BaseRecord } from '@refinedev/core';

import type { ApiError } from '@/lib/api';

export type BotPlatform = 'vk';

export interface BotsConfig {
  vk: { enabled: boolean; groupId: string | number | null };
}

export interface BotLinkCode {
  code: string;
  url: string | null;
  expiresAt: string;
}

export interface BotClaimResult {
  platform: BotPlatform;
  displayName: string;
}

export interface BotLink {
  id: string;
  platform: BotPlatform;
  displayName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const BOTS_API = {
  config: '/bots/config',
  linkCode: '/bots/link-code',
  claim: '/bots/claim',
  links: '/bots/links',
  link: (id: string) => `/bots/links/${id}`,
} as const;

export const PLATFORMS: BotPlatform[] = ['vk'];

export const PLATFORM_NAME: Record<BotPlatform, string> = { vk: 'VK' };

export const LINK_TTL_MS = 10 * 60 * 1000;
export const POLL_MS = 3000;

export function isPlatform(value: string | null): value is BotPlatform {
  return value === 'vk';
}

/** Адрес бота без кода: на случай, если сервер не вернул ссылку. */
export function botAddress(platform: BotPlatform, config: BotsConfig | null): string | null {
  if (platform !== 'vk') return null;
  const group = config?.vk.groupId;
  return group ? `https://vk.me/club${String(group).replace(/^club/, '')}` : null;
}

function useBotsGet<T>(url: string, enabled: boolean, refetchInterval?: number) {
  const { query, result } = useCustom<BaseRecord>({
    url,
    method: 'get',
    queryOptions: { enabled, retry: false, refetchInterval, refetchIntervalInBackground: false },
    errorNotification: false,
  });
  return {
    data: query.isSuccess && result.data ? (result.data as unknown as T) : null,
    isLoading: query.isLoading && enabled,
    isError: query.isError,
    error: query.error as ApiError | null,
    refetch: query.refetch,
  };
}

export function useBotsConfig() {
  return useBotsGet<BotsConfig>(BOTS_API.config, true);
}

/** Подключённые мессенджеры. Пока открыто окно привязки, список опрашивается раз в 3 секунды. */
export function useBotLinks(enabled: boolean, polling: boolean) {
  const result = useBotsGet<BotLink[]>(BOTS_API.links, enabled, polling ? POLL_MS : undefined);
  return { ...result, data: result.data?.filter((link) => link.platform === 'vk') ?? null };
}

/** Сколько секунд ждать после отказа «слишком часто». */
export function retryAfterSeconds(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const value = (error as { retryAfter?: unknown }).retryAfter;
  const seconds = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
}

export function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object' || !('code' in error)) return null;
  return typeof error.code === 'string' ? error.code : null;
}

/** Срок ссылки по часам браузера: если часы сервера и устройства расходятся, считаем 10 минут от выдачи. */
export function linkDeadline(expiresAt: string, now = Date.now()): number {
  const left = Date.parse(expiresAt) - now;
  return Number.isFinite(left) && left > 0 && left <= LINK_TTL_MS + 60_000 ? now + left : now + LINK_TTL_MS;
}
