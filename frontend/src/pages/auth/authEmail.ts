import { useInvalidateAuthStore } from '@refinedev/core';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';

import { emailAuth } from '@/api';
import { count } from '@/lib/plural';
import type { AuthConfig, AuthFlowResult } from '@/types/api';

export function useAuthConfig() {
  return useQuery<AuthConfig>({
    queryKey: ['auth', 'config'],
    queryFn: () => emailAuth.config(),
    staleTime: 5 * 60_000,
  });
}

/** Отсчёт до следующей попытки, когда сервер просит подождать. */
export function useCooldown(initialSeconds = 0) {
  const [now, setNow] = useState(() => Date.now());
  const [until, setUntil] = useState(() => (initialSeconds > 0 ? Date.now() + initialSeconds * 1000 : 0));
  useEffect(() => {
    if (until <= Date.now()) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (t >= until) window.clearInterval(id);
    }, 1000);
    return () => window.clearInterval(id);
  }, [until]);
  const start = useCallback((seconds: number) => {
    const t = Date.now();
    setNow(t);
    setUntil(t + seconds * 1000);
  }, []);
  return { left: Math.max(0, Math.ceil((until - now) / 1000)), start };
}

/** Отправка письма: занятость, итог и отсчёт, если сервер просит подождать. */
export function useMailSender() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AuthFlowResult | null>(null);
  const cooldown = useCooldown();
  const run = async (send: () => Promise<AuthFlowResult>) => {
    setBusy(true);
    setResult(null);
    const res = await send();
    setBusy(false);
    setResult(res);
    const wait = cooldownOf(res);
    if (wait) cooldown.start(wait);
    return res;
  };
  return { busy, result, left: cooldown.left, waiting: cooldown.left > 0, run };
}

const SECONDS = ['секунду', 'секунды', 'секунд'] as const;
const MINUTES = ['минуту', 'минуты', 'минут'] as const;

/** «через 45 секунд», «через 2 минуты». */
export function waitText(seconds: number): string {
  return seconds >= 60 ? count(Math.ceil(seconds / 60), MINUTES) : count(seconds, SECONDS);
}

/** Пауза при «слишком часто»: от сервера или минута по умолчанию. */
export function cooldownOf(result: AuthFlowResult): number | null {
  return result.code === 'rate_limited' ? (result.retryAfter ?? 60) : null;
}

const PENDING_KEY = 'vmeste.auth.pendingEmail';

export interface PendingSignup {
  email: string;
  name?: string;
}

/** Почта, на которую ушло письмо: живёт во вкладке, в адрес страницы не попадает. */
export const pendingSignup = {
  get(): PendingSignup | null {
    try {
      const value = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null') as PendingSignup | null;
      return value && typeof value.email === 'string' ? value : null;
    } catch {
      return null;
    }
  },
  set(value: PendingSignup) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(value));
    } catch {
      /* хранилище недоступно: экран живёт до перезагрузки */
    }
  },
  clear() {
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch {
      /* хранилище недоступно */
    }
  },
};

const verifying = new Map<string, Promise<AuthFlowResult>>();

/** Ссылка одноразовая: повторный вызов той же страницы (StrictMode, двойной рендер) получает тот же ответ. */
export function verifyOnce(token: string, attempt = 0): Promise<AuthFlowResult> {
  const key = `${attempt}:${token}`;
  let pending = verifying.get(key);
  if (!pending) {
    pending = emailAuth.verifyEmail(token);
    verifying.set(key, pending);
  }
  return pending;
}

export function resendVerification(email: string): Promise<AuthFlowResult> {
  return emailAuth.resendVerification(email);
}

/**
 * После входа: с адресом перехода — полная загрузка страницы, чтобы шапка и все экраны
 * прочитали новую сессию с нуля и не показали данные прошлого аккаунта (как после демо-входа).
 * Без адреса (вход по ссылке из письма, по коду из SMS) — только обновить шапку и права:
 * перезагрузка повторила бы одноразовую ссылку. Функция не меняется между рендерами.
 */
export function useApplySignIn() {
  const invalidate = useInvalidateAuthStore();
  const latest = useRef({ invalidate });
  useEffect(() => {
    latest.current = { invalidate };
  });
  return useCallback(async (to?: string) => {
    if (to) {
      window.location.replace(to);
      return;
    }
    await latest.current.invalidate();
  }, []);
}
