import { GENDER } from '@/lib/labels';
import type { Gender } from '@/types/domain';

/** В7: «Не указывать» — такой же равноправный вариант, как и два других. */
export type GenderChoice = Gender | 'none';

export const GENDER_CHOICES: GenderChoice[] = ['female', 'male', 'none'];

export const genderChoiceLabel = (c: GenderChoice) => (c === 'none' ? 'Не указывать' : GENDER[c]);
export const toChoice = (g: Gender | null | undefined): GenderChoice => g ?? 'none';
export const fromChoice = (c: GenderChoice): Gender | null => (c === 'none' ? null : c);

export const GENDER_HINT =
  'Пол видите только вы. Он нужен, чтобы записываться на встречи только для женщин или только для мужчин.';
