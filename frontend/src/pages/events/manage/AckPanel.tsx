import { ArrowRightIcon, CheckCircleIcon, ClockCountdownIcon } from '@phosphor-icons/react';

import { Avatar, EmptyState } from '@/components';
import { formatAgo } from '@/lib/dates';
import type { EventDetails, ParticipantView } from '@/types/api';

import styles from './manage.module.css';

function Names({ people }: { people: ParticipantView[] }) {
  return (
    <ul className={styles.names}>
      {people.map((p) => (
        <li key={p.id} className={styles.name}>
          <Avatar name={p.user.name} initials={p.user.initials} src={p.user.avatarUrl} size={32} />
          {p.user.name}
        </li>
      ))}
    </ul>
  );
}

/** Кто подтвердил «Я в курсе» после каждого изменения: организатор видит, кому ещё написать. */
export function AckPanel({ event }: { event: EventDetails }) {
  const people = [
    ...(event.manage?.confirmed ?? []),
    ...(event.manage?.pending ?? []),
    ...(event.manage?.waitlist ?? []),
  ];
  const changes = [...event.changes].reverse();
  if (!changes.length) {
    return (
      <EmptyState title="Изменений не было">
        Если вы перенесёте встречу или поменяете место, участники получат уведомление, а здесь вы увидите, кто
        подтвердил.
      </EmptyState>
    );
  }
  return (
    <div className={styles.thread}>
      {changes.map((c) => {
        const known = people.filter((p) => c.acknowledgedBy.includes(p.userId));
        const unknown = people.filter((p) => !c.acknowledgedBy.includes(p.userId));
        return (
          <section key={c.id} className={styles.change} aria-label={`Изменение ${formatAgo(c.at)}`}>
            <p className={styles.personMeta}>Изменено {formatAgo(c.at)}</p>
            <ul className={styles.changeItems}>
              {c.items.map((item) => (
                <li key={item.field}>
                  <strong>{item.label}:</strong>
                  <span className={styles.from}>
                    <span className="sr-only">было </span>
                    {item.from}
                  </span>
                  <ArrowRightIcon size={16} aria-hidden />
                  <span className={styles.to}>
                    <span className="sr-only">стало </span>
                    {item.to}
                  </span>
                </li>
              ))}
            </ul>
            <div className={styles.ackColumns}>
              <div>
                <p className={styles.ackTitle}>
                  <CheckCircleIcon size={20} weight="fill" className={styles.ok} aria-hidden />В курсе:{' '}
                  {known.length}
                </p>
                {known.length ? (
                  <Names people={known} />
                ) : (
                  <p className={styles.note}>Пока никто не подтвердил.</p>
                )}
              </div>
              <div>
                <p className={styles.ackTitle}>
                  <ClockCountdownIcon size={20} weight="fill" className={styles.wait} aria-hidden />
                  Ещё не подтвердили: {unknown.length}
                </p>
                {unknown.length ? (
                  <Names people={unknown} />
                ) : (
                  <p className={styles.note}>Все знают об изменении.</p>
                )}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}
