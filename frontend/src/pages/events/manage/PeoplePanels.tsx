import { ShareNetworkIcon, UserCircleIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useRef, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Avatar, Button, EmptyState, StatusBadge } from '@/components';
import { formatAgo } from '@/lib/dates';
import { SKILL_LEVEL } from '@/lib/labels';
import { count } from '@/lib/plural';
import type { EventDetails, ParticipantView } from '@/types/api';

import styles from './manage.module.css';
import { EscortMark } from '../venues/EscortOption'; // Н1
import { YEAR_WORDS, ageText } from '../event/company/labels';
import { StopListedMark } from './PersonActions'; // D-16
import { usePeopleActions } from './usePeopleActions';

function personMeta(p: ParticipantView): string {
  return [
    p.user.level ? SKILL_LEVEL[p.user.level] : null,
    p.user.age ? count(p.user.age, YEAR_WORDS) : null,
    p.source === 'invite'
      ? 'по вашему приглашению'
      : p.source === 'gathered'
        ? 'из объявления «Ищу компанию»'
        : null,
  ]
    .filter(Boolean)
    .join(', ');
}

function PersonRow({
  p,
  aside,
  lead,
  since = 'Записались',
  fresh,
}: {
  p: ParticipantView;
  aside?: ReactNode;
  lead?: ReactNode;
  since?: string;
  fresh?: boolean;
}) {
  const meta = personMeta(p);
  return (
    <li className={[styles.person, fresh && 'status-flash'].filter(Boolean).join(' ')}>
      {lead ?? <Avatar name={p.user.name} initials={p.user.initials} src={p.user.avatarUrl} size={48} />}
      <div className={styles.personBody}>
        <Link to={`/profile/${p.user.id}`} className={styles.personName}>
          {p.user.name}
        </Link>
        {meta && <span className={styles.personMeta}>{meta}</span>}
        <EscortMark needed={p.needsEscort} />
        {!!p.children?.length && (
          <span className={styles.personMeta}>
            С детьми: {p.children.map((c) => `${c.name}, ${ageText(c.age)}`).join('; ')}
          </span>
        )}
        <span className={styles.personMeta}>
          {since} {formatAgo(p.decidedAt ?? p.createdAt)}
        </span>
        {p.status === 'removed' && p.removedReason && (
          <span className={styles.personMeta}>Причина: {p.removedReason}</span>
        )}
        {p.stopListed && (
          <span className={styles.personBadges}>
            <StopListedMark on />
          </span>
        )}
      </div>
      {aside && <div className={styles.personAside}>{aside}</div>}
    </li>
  );
}

export function ParticipantsPanel({ event }: { event: EventDetails }) {
  const { message } = App.useApp();
  const people = usePeopleActions(event);
  const confirmed = [...(event.manage?.confirmed ?? [])].reverse();
  // Кто записался, пока страница открыта, оказывается сверху и подсвечивается.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(confirmed.map((p) => p.id));
  const declined = event.manage?.declined ?? [];

  const share = async () => {
    const url = `${window.location.origin}/events/${event.id}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success('Ссылка на событие скопирована');
    } catch {
      message.info(url);
    }
  };

  return (
    <>
      {confirmed.length ? (
        <ul className={styles.list} aria-label="Участники">
          {confirmed.map((p) => (
            <PersonRow
              key={p.id}
              p={p}
              fresh={!seen.current!.has(p.id)}
              aside={
                <>
                  <Button
                    size="sm"
                    variant="quiet"
                    to={`/profile/${p.user.id}`}
                    icon={<UserCircleIcon size={20} aria-hidden />}
                  >
                    Профиль
                  </Button>
                  {people.menu(p)}
                </>
              }
            />
          ))}
        </ul>
      ) : (
        <EmptyState
          title="Пока никто не записался"
          icon={<ShareNetworkIcon size={28} aria-hidden />}
          actions={
            event.state === 'upcoming' && (
              <Button variant="primary" icon={<ShareNetworkIcon size={20} aria-hidden />} onClick={share}>
                Скопировать ссылку
              </Button>
            )
          }
        >
          Отправьте ссылку знакомым или в чат двора. Кто запишется, сразу появится здесь.
        </EmptyState>
      )}

      {confirmed.length > 0 && (
        <p className={styles.note}>
          Телефоны участников на платформе не показываются. Важное пишите в обсуждении: его видят все
          записавшиеся.
        </p>
      )}

      {declined.length > 0 && (
        <>
          <h3 className={styles.subhead}>Отказались и отклонённые</h3>
          <ul className={styles.list} aria-label="Отказались и отклонённые">
            {declined.map((p) => (
              <PersonRow
                key={p.id}
                p={p}
                since="Обновлено"
                aside={
                  <>
                    <StatusBadge kind="participation" status={p.status} audience="organizer" />
                    {people.menu(p)}
                  </>
                }
              />
            ))}
          </ul>
        </>
      )}
      {people.dialogs}
    </>
  );
}

export function WaitlistPanel({ event, editLink }: { event: EventDetails; editLink: string }) {
  const queue = event.manage?.waitlist ?? [];
  const people = usePeopleActions(event);
  const auto =
    event.joinMode === 'open'
      ? 'Когда освободится место, первый в очереди станет участником сам и получит уведомление.'
      : 'Когда освободится место, заявка первого в очереди придёт вам на решение.';

  if (!queue.length) {
    return (
      <EmptyState title="В листе ожидания никого нет">
        Если места закончатся, новые люди встанут в очередь. {auto}
      </EmptyState>
    );
  }
  return (
    <>
      <div className={styles.hintBox}>
        <p>{auto}</p>
        {event.state === 'upcoming' && (
          <Button size="sm" variant="secondary" to={editLink}>
            Увеличить лимит мест
          </Button>
        )}
      </div>
      <ol className={styles.list} aria-label="Лист ожидания по порядку">
        {queue.map((p, i) => (
          <PersonRow
            key={p.id}
            p={p}
            since="Встали в очередь"
            aside={people.menu(p)}
            lead={
              <span className={styles.position} aria-label={`${p.waitlistPosition ?? i + 1}-й в очереди`}>
                {p.waitlistPosition ?? i + 1}
              </span>
            }
          />
        ))}
      </ol>
      {people.dialogs}
    </>
  );
}
