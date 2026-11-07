import { useLiveGet } from '@/lib/api';
import type { StopListView, StopOwnerKey } from '@/types/api';

import { STOP_API, STOP_LIVE } from './stopApi';

/** Стоп-лист владельца с живым обновлением. `active` — сколько записей действует сейчас. */
export function useStopList(owner: StopOwnerKey | null) {
  const res = useLiveGet<StopListView>(owner ? STOP_API.list(owner) : '', STOP_LIVE, Boolean(owner));
  const list = res.data && Array.isArray(res.data.entries) ? res.data : null;
  return { ...res, data: list, active: list?.entries.filter((e) => e.state === 'active').length ?? 0 };
}
