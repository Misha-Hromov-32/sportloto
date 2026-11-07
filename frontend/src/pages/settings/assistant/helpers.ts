import type { JsonSchema } from '@/types/mcp';

export type ArgValues = Record<string, unknown>;

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Начальные значения: пример из схемы, если он есть. */
export function initialArgs(schema: JsonSchema): ArgValues {
  const out: ArgValues = {};
  for (const [key, p] of Object.entries(schema.properties ?? {})) {
    if (p.examples?.length) out[key] = p.examples[0];
  }
  return out;
}

/** Пустые поля не отправляются: сервер подставит значения по умолчанию сам. */
export function cleanArgs(values: ArgValues): ArgValues {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '')),
  );
}
