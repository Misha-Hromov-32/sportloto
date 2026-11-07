import {
  BabyIcon,
  CalendarBlankIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  InfoIcon,
  MedalIcon,
  PlantIcon,
  UserCircleIcon,
  UserIcon,
  UsersThreeIcon,
} from '@phosphor-icons/react';
import { useEffect } from 'react';
import { Link } from 'react-router';

import { Avatar } from '@/components';
import { formatAgo } from '@/lib/dates';
import { SKILL_LEVEL } from '@/lib/labels';
import { count, WORDS } from '@/lib/plural';
import type { OrganizerPendingView } from '@/types/api';

import { ageText } from '../../event/company/labels';
import { EscortMark } from '../../venues/EscortOption';
import { DESKTOP, useMediaQuery } from '../../feed/useMediaQuery';
import { StopListedMark } from '../PersonActions';
import styles from './review.module.css';

const seatsText = (n: number) => `займёт ${count(n, WORDS.place)}`;

interface ApplicantCardProps {
  application: OrganizerPendingView;
  /** В общей стопке у карточки подпись, к какой встрече заявка. */
  showEvent: boolean;
  /** Причина, по которой принять нельзя: не хватает мест. */
  blocked: boolean;
  editLink: string;
  expanded: boolean;
  onToggle: () => void;
  onProfile: () => void;
}

/** Карточка заявителя в стопке «По одной». */
export function ApplicantCard({
  application: a,
  showEvent,
  blocked,
  editLink,
  expanded,
  onToggle,
  onProfile,
}: ApplicantCardProps) {
  const { user } = a;
  const children = a.children ?? [];
  const teamPeople = a.teamId ? Math.max(1, a.seats - children.length) : 0;
  const novice = a.attended === 0 || a.firstVisit;
  const wide = useMediaQuery(DESKTOP);

  // Касание карточки или Enter открывают профиль поверх стопки
  useEffect(() => {
    if (expanded) onProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  return (
    <article className={styles.face}>
      {showEvent && (
        <p className={styles.eventLine}>
          <CalendarBlankIcon size={18} aria-hidden />
          <span>Заявка на «{a.event.title}»</span>
        </p>
      )}

      {blocked && (
        <p className={styles.blocked}>
          <InfoIcon size={20} aria-hidden />
          <span>
            Чтобы принять заявку, нужно больше мест.{' '}
            <Link to={editLink} onClick={(e) => e.stopPropagation()}>
              Увеличить лимит
            </Link>
          </span>
        </p>
      )}

      <div className={styles.who}>
        <Avatar name={user.name} initials={user.initials} src={user.avatarUrl} size={wide ? 96 : 56} />
        <div className={styles.whoText}>
          <h3 className={styles.name}>{user.name}</h3>
          <p className={styles.facts}>
            {user.age !== null && (
              <span>
                <UserIcon size={18} aria-hidden />
                {ageText(user.age)}
              </span>
            )}
            <span>
              <MedalIcon size={18} aria-hidden />
              {user.level ? `Уровень: ${SKILL_LEVEL[user.level].toLowerCase()}` : 'Уровень не указан'}
            </span>
            <span>
              <ClockCountdownIcon size={18} aria-hidden />
              Заявка {formatAgo(a.createdAt)}
            </span>
          </p>
        </div>
      </div>

      <p className={styles.experience}>
        <CheckCircleIcon size={20} aria-hidden />
        <span>{a.attended > 0 ? `Встреч на платформе: ${a.attended}` : 'Первая встреча на платформе'}</span>
        {novice && (
          <span className={[styles.mark, styles.markNew].join(' ')}>
            <PlantIcon size={16} weight="fill" aria-hidden />
            Новичок
          </span>
        )}
      </p>

      {a.note ? (
        <blockquote className={styles.quote}>«{a.note}»</blockquote>
      ) : (
        <p className={[styles.quote, styles.quoteEmpty].join(' ')}>Без сообщения</p>
      )}

      {(a.needsEscort || children.length > 0 || teamPeople > 0 || a.stopListed) && (
        <div className={styles.marks}>
          <EscortMark needed={a.needsEscort} />
          {children.length > 0 && (
            <span className={styles.mark}>
              <BabyIcon size={16} weight="fill" aria-hidden />С детьми: {children.length} (
              {seatsText(a.seats)})
            </span>
          )}
          {teamPeople > 0 && (
            <span className={styles.mark}>
              <UsersThreeIcon size={16} weight="fill" aria-hidden />
              Команда: {count(teamPeople, WORDS.person)} ({seatsText(a.seats)})
            </span>
          )}
          <StopListedMark on={a.stopListed} />
        </div>
      )}

      <div className={styles.foot}>
        <button
          type="button"
          className={styles.profile}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          aria-haspopup="dialog"
        >
          <UserCircleIcon size={20} aria-hidden />
          Профиль
        </button>
      </div>
    </article>
  );
}
