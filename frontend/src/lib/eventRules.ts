import type { SportEvent } from '@/types/domain';

/** Свободная публичная встреча принимает вопросы до записи. */
export function publicDiscussion(event: Pick<SportEvent, 'joinMode' | 'visibility'>): boolean {
  return event.joinMode === 'open' && event.visibility !== 'invite';
}
