import { ArrowRightIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { formatAgo } from '@/lib/dates';
import type { NotificationView } from '@/types/api';

import { NOTICE_META, parseChange } from './notificationMeta';
import styles from './NotificationItem.module.css';

interface NotificationItemProps {
  notice: NotificationView;
  onOpen: (notice: NotificationView) => void;
}

/** Одно уведомление: что случилось, когда и куда ведёт. Непрочитанное помечено словом, а не только цветом. */
export function NotificationItem({ notice, onOpen }: NotificationItemProps) {
  const meta = NOTICE_META[notice.type] ?? NOTICE_META.question;
  const Icon = meta.icon;
  const change = notice.type === 'changed' ? parseChange(notice.text) : null;

  return (
    <li className={[styles.item, !notice.read && styles.unread].filter(Boolean).join(' ')}>
      <Link to={notice.link} className={styles.link} onClick={() => onOpen(notice)}>
        <span className={[styles.noticeIcon, styles[meta.tone]].join(' ')}>
          <Icon size={23} weight="regular" aria-hidden />
        </span>
        <span className={styles.body}>
          <span className={styles.head}>
            <span className={styles.title}>{notice.title}</span>
            {!notice.read && <span className={styles.new}>Новое</span>}
          </span>
          {change ? (
            <span className={styles.text}>
              {change.subject && <span className={styles.subject}>{change.subject}</span>}
              <span className={styles.changes}>
                {change.items.map((c, i) => (
                  <span key={i} className={styles.change}>
                    {c.label && <span className={styles.changeLabel}>{c.label}</span>}
                    <span className={styles.from}>
                      <span className="sr-only">было </span>
                      {c.from}
                    </span>
                    <ArrowRightIcon size={16} aria-hidden className={styles.arrow} />
                    <span className={styles.to}>
                      <span className="sr-only">стало </span>
                      {c.to}
                    </span>
                  </span>
                ))}
              </span>
            </span>
          ) : (
            <span className={styles.text}>{notice.text}</span>
          )}
          <span className={styles.foot}>
            <span>{meta.kind}</span>
            <time dateTime={notice.createdAt}>{formatAgo(notice.createdAt)}</time>
          </span>
        </span>
      </Link>
    </li>
  );
}
