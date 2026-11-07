import { useLiveGet } from '@/lib/api';
import type { AdminStopSummary, StopEntryView, StopSignal } from '@/types/api';

export const STOP_ADMIN_API = {
  /** GET `?orgId=` или `?userId=` → `AdminStopSummary`. */
  list: '/admin/stop-list',
  /** POST `{ reason }` → `StopEntryView`. */
  lift: (entryId: string) => `/admin/stop-list/${entryId}/lift`,
  /** GET → `StopSignal[]`. */
  signals: '/admin/stop-signals',
} as const;

const LIVE = ['stop-list', 'participations', 'organizations', 'users', 'audit', 'admin', 'demo'];

export function useAdminStopList(by: { orgId: string } | { userId: string }, enabled = true) {
  const [key, value] = 'orgId' in by ? ['orgId', by.orgId] : ['userId', by.userId];
  return useLiveGet<AdminStopSummary>(
    `${STOP_ADMIN_API.list}?${key}=${encodeURIComponent(value)}`,
    LIVE,
    enabled && Boolean(value),
  );
}

export function useStopSignals(enabled = true) {
  return useLiveGet<StopSignal[]>(STOP_ADMIN_API.signals, LIVE, enabled);
}

export function activeCount(entries: StopEntryView[]): number {
  return entries.filter((e) => e.state === 'active').length;
}
