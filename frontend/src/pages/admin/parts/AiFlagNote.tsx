import { RobotIcon } from '@phosphor-icons/react';
import { useId, useState } from 'react';

import type { AiFlag } from '@/types/domain';

import styles from './admin.module.css';
import { flagTitle, type FlagSubject } from './labels';

/** Короткая пометка помощника в строке списка: что заподозрил и «почему так». */
export function AiFlagNote({
  flag,
  reason,
  subject,
}: {
  flag: AiFlag;
  reason: string;
  subject: FlagSubject;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  if (flag === 'none') return null;
  return (
    <span className={styles.flagNote}>
      <RobotIcon size={18} aria-hidden />
      <span>Помощник отметил: {flagTitle(flag, subject).toLowerCase()}</span>
      {reason && (
        <button
          type="button"
          className={styles.flagWhy}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'Скрыть причину' : 'Почему так'}
        </button>
      )}
      {open && (
        <span id={id} className={styles.flagReason}>
          {reason}
        </span>
      )}
    </span>
  );
}
