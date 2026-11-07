import { PauseCircleIcon } from '@phosphor-icons/react';

import { formatAgo } from '@/lib/dates';
import type { OrganizationView } from '@/types/api';

import styles from './suspension.module.css';

/** С17: пометка на странице и в кабинете организации, у которой приостановлен допуск. */
export function SuspensionNotice({ org }: { org: OrganizationView }) {
  const s = org.suspension;
  if (!s) return null;
  return (
    <div className={styles.notice} role="note">
      <PauseCircleIcon size={24} aria-hidden className={styles.icon} />
      <div>
        <p className={styles.title}>Допуск организации приостановлен администратором</p>
        {org.isOwner ? (
          <p className={styles.text}>
            Приостановлен {formatAgo(s.at)}. Причина: {s.reason} Опубликованные встречи остаются, новые публиковать пока нельзя. Когда
            исправите, напишите администратору, и он возобновит допуск.
          </p>
        ) : (
          <p className={styles.text}>Новые встречи организации пока не публикуются. Уже объявленные проходят как обычно.</p>
        )}
      </div>
    </div>
  );
}
