import { useEffect, useState } from 'react';

import { emailAuth } from '@/api';
import type { AuthFlowResult } from '@/types/api';

/** Десять цифр номера после +7: «8 912…», «+7 912…» и «912…» дают одно и то же. */
export function nationalDigits(value: string): string {
  const digits = value.replace(/\D/g, '');
  const local = /^[78]/.test(digits) ? digits.slice(1) : digits;
  return local.slice(0, 10);
}

/** «+7 912 345-67-89» по мере ввода. */
export function formatPhone(national: string): string {
  if (!national) return '';
  const n = national.slice(0, 10);
  let out = `+7 ${n.slice(0, 3)}`;
  if (n.length > 3) out += ` ${n.slice(3, 6)}`;
  if (n.length > 6) out += `-${n.slice(6, 8)}`;
  if (n.length > 8) out += `-${n.slice(8, 10)}`;
  return out;
}

/** «+7 912 ***-**-89»: номер узнаётся, но целиком на экране не виден. */
export function maskPhone(national: string): string {
  return `+7 ${national.slice(0, 3)} ***-**-${national.slice(8, 10)}`;
}

/**
 * Мягкое форматирование: пока человек печатает в конце строки, номер раскладывается по группам.
 * Правка в середине не трогается до ухода из поля, иначе курсор прыгал бы в конец.
 */
export function typePhone(raw: string, prev: string, caretAtEnd: boolean): string {
  if (!caretAtEnd) return raw;
  if (raw === '+' || raw === '') return raw;
  let national = nationalDigits(raw);
  if (raw.length < prev.length && national === nationalDigits(prev)) {
    national = national.slice(0, -1);
  }
  if (!national) return /^\+?[78]?$/.test(raw.replace(/\s/g, '')) ? raw.trim() : '';
  return formatPhone(national);
}

export function sendPhoneCode(email: string, password: string, national: string): Promise<AuthFlowResult> {
  return emailAuth.sendPhoneCode(email, password, `+7${national}`);
}

export function verifyPhoneCode(email: string, national: string, code: string): Promise<AuthFlowResult> {
  return emailAuth.verifyPhoneCode(email, `+7${national}`, code);
}

/** Запасной путь показываем не сразу: сначала человек ждёт письмо. */
export function useRevealAfter(ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (ms <= 0) return;
    const id = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(id);
  }, [ms]);
  return ms <= 0 || shown;
}
