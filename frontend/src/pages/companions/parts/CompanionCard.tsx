import {
  BarbellIcon,
  ClockIcon,
  FlagIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  SparkleIcon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';

import { AssistantMark, Avatar, AvatarStack, SportIcon, StatusBadge } from '@/components';
import { formatAgo } from '@/lib/dates';
import { formatDistance } from '@/lib/geo';
import { SKILL_LEVEL } from '@/lib/labels';
import type { StatusMeta } from '@/lib/labels';
import { count, WORDS } from '@/lib/plural';
import type { CompanionView } from '@/types/api';
import type { CompanionStatus } from '@/types/domain';

import styles from './companions.module.css';

const STATUS: Record<CompanionStatus, StatusMeta> = {
  open: { label: 'Открыто', tone: 'ok', icon: 'check' },
  gathered: { label: 'Встреча собрана', tone: 'ok', icon: 'check' },
  closed: { label: 'Закрыто', tone: 'off', icon: 'lock' },
};

interface CompanionCardProps {
  companion: CompanionView;
  actions?: ReactNode;
  /** Пометки помощника у полей (предпросмотр нового объявления). */
  marks?: Partial<Record<'sport' | 'district' | 'when' | 'level' | 'readiness' | 'text', string>>;
  preview?: boolean;
}

/** Объявление «Ищу компанию»: кто, чем хочет заниматься, где и когда, кто уже откликнулся. */
export function CompanionCard({ companion: c, actions, marks = {}, preview }: CompanionCardProps) {
  const mark = (key: keyof typeof marks) =>
    marks[key] !== undefined ? <AssistantMark why={marks[key]} /> : null;
  return (
    <article className={[styles.card, c.status !== 'open' && styles.cardOff].filter(Boolean).join(' ')}>
      <header className={styles.cardHead}>
        <span className={styles.sport}>
          <SportIcon sport={c.sport} size={20} />
          {c.sport.name}
          {mark('sport')}
        </span>
        <span className={styles.readinessTag}>
          {c.isDemo && 'Демо · '}
          {c.readiness === 'organize' ? (
            <FlagIcon size={18} weight="fill" aria-hidden />
          ) : (
            <MagnifyingGlassIcon size={18} aria-hidden />
          )}
          {c.readiness === 'organize' ? 'Соберёт встречу' : 'Ищет компанию'}
          {mark('readiness')}
        </span>
        {c.isMine && !preview && <StatusBadge kind="custom" meta={STATUS[c.status]} />}
      </header>

      <p className={styles.text}>
        {c.text}
        {mark('text')}
      </p>

      <ul className={styles.meta}>
        <li>
          <MapPinIcon size={18} aria-hidden />
          <span>
            {c.districtName ?? 'Район не указан'}
            {c.distanceKm !== null && (
              <span className={styles.distance}>{formatDistance(c.distanceKm)} от вас</span>
            )}
          </span>
          {mark('district')}
        </li>
        <li>
          <ClockIcon size={18} aria-hidden />
          <span>{c.when}</span>
          {mark('when')}
        </li>
        <li>
          <BarbellIcon size={18} aria-hidden />
          <span>{SKILL_LEVEL[c.level]}</span>
          {mark('level')}
        </li>
      </ul>

      {c.matchReasons.length > 0 && (
        <div className={styles.match}>
          <span className={styles.matchLabel}>
            <SparkleIcon size={18} weight="fill" aria-hidden />
            Вам подходит
          </span>
          <ul className={styles.matchList}>
            {c.matchReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      <footer className={styles.foot}>
        <div className={styles.author}>
          <Avatar name={c.author.name} src={c.author.avatarUrl} initials={c.author.initials} size={40} />
          <span className={styles.authorText}>
            {preview ? (
              <span className={styles.authorName}>{c.author.name}</span>
            ) : (
              <Link to={`/profile/${c.author.id}`} className={styles.authorName}>
                {c.author.name}
              </Link>
            )}
            <span className={styles.ago}>{preview ? 'Сейчас' : formatAgo(c.createdAt)}</span>
          </span>
        </div>
        <div className={styles.metoo} aria-live="polite">
          {c.metooCount > 0 ? (
            <>
              <AvatarStack people={c.metooPeople} max={4} />
              <span>
                Тоже {c.metooCount === 1 ? 'хочет' : 'хотят'}: <strong className="num">{c.metooCount}</strong>
              </span>
            </>
          ) : (
            <span className={styles.muted}>
              {preview ? 'Откликнувшиеся появятся здесь' : 'Пока никто не откликнулся'}
            </span>
          )}
        </div>
      </footer>

      {c.isMine && c.status === 'gathered' && c.eventId && (
        <p className={styles.gathered}>
          Из объявления собрали встречу, {count(c.metooCount, WORDS.person)} в списке.{' '}
          <Link to={`/events/${c.eventId}`}>Открыть встречу</Link>
        </p>
      )}

      {actions && <div className={styles.actions}>{actions}</div>}
    </article>
  );
}
