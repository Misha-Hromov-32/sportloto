import { CardsIcon, TrayIcon } from '@phosphor-icons/react';

import { Button } from '@/components';
import { useSettings } from '@/theme/useSettings';

import { pendingSummary } from './reviewModel';
import styles from './review.module.css';
import { usePendingApplications } from './usePendingApplications';

/** Кабинет, «Организую»: сколько новых заявок по всем событиям и вход в стопку «По одной». */
export function PendingReviewBlock({ onOpen }: { onOpen: () => void }) {
  const { settings } = useSettings();
  const { items } = usePendingApplications({ enabled: !settings.simple });
  if (settings.simple || items.length === 0) return null;
  const events = new Set(items.map((p) => p.event.id)).size;
  return (
    <section className={styles.pendingBlock} aria-label="Новые заявки">
      <p className={styles.pendingText}>
        <TrayIcon size={22} weight="fill" aria-hidden />
        {pendingSummary(items.length, events)}
      </p>
      <Button variant="primary" icon={<CardsIcon size={20} aria-hidden />} onClick={onOpen}>
        Разобрать
      </Button>
    </section>
  );
}
