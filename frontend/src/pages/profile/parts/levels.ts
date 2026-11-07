import type { SkillLevel } from '@/types/domain';

/** Уровень простыми словами: человеку проще узнать себя в описании, чем в ярлыке. */
export const LEVEL_WORDS: Record<SkillLevel, { label: string; hint: string }> = {
  beginner: { label: 'Новичок', hint: 'только начинаю' },
  amateur: { label: 'Любитель', hint: 'занимаюсь для себя' },
  experienced: { label: 'Опытный', hint: 'давно и уверенно' },
};

export const LEVEL_ORDER: SkillLevel[] = ['beginner', 'amateur', 'experienced'];
