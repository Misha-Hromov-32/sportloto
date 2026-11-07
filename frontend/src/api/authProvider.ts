import type { AuthActionResponse, AuthProvider } from '@refinedev/core';

import type { AuthConfig, AuthFlowResult, EmailAuth, Identity } from '@/types/api';
import type { RegisterInput } from '@/types/inputs';

import { ApiError, apiRequest } from './client';
import { emitLocal } from './liveProvider';
import { session } from './session';

/**
 * Вход на сервере: демо-аккаунт в один клик (`/auth/demo-login`), почта и пароль (`/auth/login`;
 * у демо-аккаунтов пароля нет — поле оставляют пустым), регистрация (`/auth/register`).
 * Сервер выдаёт токен сессии, вкладка хранит его у себя — две вкладки могут работать под разными ролями.
 * Если на сервере включено подтверждение почты, регистрация не входит сразу, а отправляет письмо.
 */

export interface LoginParams {
  userId?: string;
  email?: string;
  password?: string;
  redirectTo?: string;
}

interface SessionResponse {
  id: string;
  token: string;
  identity: Identity | null;
}

interface VerificationSent {
  status: 'verification_sent';
  email: string;
}

function safeRedirect(to: unknown, fallback: string): string {
  return typeof to === 'string' && to.startsWith('/') && !to.startsWith('//') ? to : fallback;
}

function homeFor(identity: Identity | null): string {
  return identity?.role === 'admin' ? '/admin' : '/me';
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof ApiError || (error instanceof Error && error.message) ? error.message : fallback;
}

/** Вошли или вышли: все ответы зависят от того, кто смотрит, — обновляем всё. */
function signedIn(res: SessionResponse) {
  session.set(res.token, res.id);
  emitLocal();
}

function flowError(error: unknown): AuthFlowResult {
  if (!(error instanceof ApiError)) {
    return { ok: false, code: 'internal', message: errorText(error, 'Не получилось. Попробуйте ещё раз') };
  }
  const attemptsLeft = Number(error.attemptsLeft);
  return {
    ok: false,
    code: error.code,
    message: error.message,
    retryAfter: seconds(error.retryAfter),
    email: typeof error.email === 'string' ? error.email : undefined,
    fieldErrors: error.errors,
    attemptsLeft:
      error.attemptsLeft !== undefined && Number.isFinite(attemptsLeft) && attemptsLeft >= 0
        ? Math.floor(attemptsLeft)
        : undefined,
  };
}

function seconds(value: unknown): number | undefined {
  const n = Number(value);
  return value !== undefined && value !== null && Number.isFinite(n) && n > 0 ? Math.ceil(n) : undefined;
}

function failed(name: string, flow: AuthFlowResult): AuthActionResponse {
  return { ...flow, success: false, error: { name, message: flow.message ?? 'Попробуйте ещё раз' } };
}

export const authProvider: AuthProvider = {
  login: async ({ userId, email, password, redirectTo }: LoginParams) => {
    try {
      const res = userId
        ? await apiRequest<SessionResponse>('post', '/auth/demo-login', { body: { userId } })
        : await apiRequest<SessionResponse>('post', '/auth/login', {
            body: { email: String(email ?? '').trim(), password: password ?? '' },
          });
      signedIn(res);
      return { success: true, redirectTo: safeRedirect(redirectTo, homeFor(res.identity)) };
    } catch (error) {
      return failed('Не удалось войти', flowError(error));
    }
  },

  register: async (params: RegisterInput & { password?: string; redirectTo?: string }) => {
    try {
      const { redirectTo, ...input } = params;
      const res = await apiRequest<SessionResponse | VerificationSent>('post', '/auth/register', {
        body: input,
      });
      if ('status' in res && res.status === 'verification_sent') {
        return { success: true, verificationSent: true, email: res.email || input.email };
      }
      signedIn(res as SessionResponse);
      return { success: true, redirectTo: safeRedirect(redirectTo, '/me') };
    } catch (error) {
      return failed('Не удалось зарегистрироваться', flowError(error));
    }
  },

  forgotPassword: async ({ email }: { email: string }) => {
    try {
      await apiRequest('post', '/auth/password/forgot', { body: { email: email.trim() } });
      return { success: true };
    } catch (error) {
      return failed('Не удалось отправить письмо', flowError(error));
    }
  },

  updatePassword: async ({ token, password }: { token: string; password: string }) => {
    try {
      const res = await apiRequest<SessionResponse>('post', '/auth/password/reset', {
        body: { token, password },
      });
      signedIn(res);
      return { success: true, redirectTo: homeFor(res.identity) };
    } catch (error) {
      return failed('Не удалось сменить пароль', flowError(error));
    }
  },

  logout: async () => {
    try {
      await apiRequest('post', '/auth/logout');
    } catch {
      // Сессия на сервере истечёт сама; во вкладке выходим в любом случае.
    }
    session.clear();
    emitLocal();
    return { success: true, redirectTo: '/' };
  },

  check: async () => {
    if (!session.token) return { authenticated: false, redirectTo: '/login', logout: true };
    const identity = await authProvider.getIdentity!();
    return identity ? { authenticated: true } : { authenticated: false, redirectTo: '/login', logout: true };
  },

  onError: async (error: { statusCode?: number }) => {
    if (error?.statusCode === 401) return { logout: true, redirectTo: '/login' };
    return {};
  },

  getIdentity: async () => {
    if (!session.token) return null;
    try {
      const identity = await apiRequest<Identity | null>('get', '/me');
      // Сессия истекла или аккаунт удалён сбросом демо-данных — во вкладке её больше нет.
      if (!identity) session.clear();
      return identity;
    } catch (error) {
      if (error instanceof ApiError && error.statusCode === 401) session.clear();
      return null;
    }
  },

  getPermissions: async () => {
    const identity = (await authProvider.getIdentity!()) as Identity | null;
    return identity?.role ?? 'guest';
  },
};

const NO_MAIL: AuthConfig = { emailVerification: false, passwordReset: false, phoneVerification: false };

export const emailAuth: EmailAuth = {
  deleteAccount: async (password) => {
    try {
      await apiRequest('post', '/auth/delete-account', { body: { password } });
      return { ok: true };
    } catch (error) {
      return flowError(error);
    }
  },

  config: async () => {
    try {
      const res = await apiRequest<Partial<AuthConfig>>('get', '/auth/config');
      return {
        emailVerification: res?.emailVerification === true,
        passwordReset: res?.passwordReset === true,
        phoneVerification: res?.phoneVerification === true,
      };
    } catch (error) {
      // Старый сервер без этих настроек: писем нет, вход как раньше. Сбой связи — повод повторить.
      if (error instanceof ApiError && error.statusCode === 404) return NO_MAIL;
      throw error;
    }
  },

  verifyEmail: async (token) => {
    try {
      const res = await apiRequest<SessionResponse>('post', '/auth/verify-email', { body: { token } });
      signedIn(res);
      return { ok: true };
    } catch (error) {
      return flowError(error);
    }
  },

  resendVerification: async (email) => {
    try {
      await apiRequest('post', '/auth/resend-verification', { body: { email: email.trim() } });
      return { ok: true };
    } catch (error) {
      return flowError(error);
    }
  },

  sendPhoneCode: async (email, password, phone) => {
    try {
      const res = await apiRequest<{ resendIn?: number; expiresIn?: number }>('post', '/auth/phone/send', {
        body: { email: email.trim(), password, phone },
      });
      return { ok: true, resendIn: seconds(res?.resendIn), expiresIn: seconds(res?.expiresIn) };
    } catch (error) {
      return flowError(error);
    }
  },

  verifyPhoneCode: async (email, phone, code) => {
    try {
      const res = await apiRequest<SessionResponse>('post', '/auth/phone/verify', {
        body: { email: email.trim(), phone, code },
      });
      signedIn(res);
      return { ok: true };
    } catch (error) {
      return flowError(error);
    }
  },
};
