import { SealCheck, User } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { ORG_TYPE } from '@/lib/labels';
import type { OrganizerView } from '@/types/api';

import { Avatar } from '../Avatar/Avatar';
import styles from './OrganizerBlock.module.css';

interface OrganizerBlockProps {
  organizer: OrganizerView;
  /** Подпись над именем: «Организатор», «Проводит». */
  caption?: string;
  compact?: boolean;
}

/** Кто проводит: метка доверия и честные факты без рейтингов людей. */
export function OrganizerBlock({ organizer, caption = 'Организатор', compact }: OrganizerBlockProps) {
  const { facts } = organizer;
  const factsText =
    facts.held === 0 && facts.cancelled === 0
      ? 'Первая встреча этого организатора на платформе'
      : `Встреч проведено: ${facts.held}, отменено: ${facts.cancelled}`;

  return (
    <div className={[styles.root, compact && styles.compact].filter(Boolean).join(' ')}>
      <Avatar
        name={organizer.name}
        src={organizer.avatarUrl}
        size={compact ? 40 : 56}
        shape={organizer.kind === 'org' ? 'org' : 'person'}
      />
      <div className={styles.body}>
        <span className={styles.caption}>{caption}</span>
        <Link to={organizer.link} className={styles.name}>
          {organizer.name}
        </Link>
        {organizer.verified ? (
          <span className={[styles.trust, styles.verified].join(' ')}>
            <SealCheck size={18} weight="fill" aria-hidden />
            Организация проверена
            {organizer.orgType && <span className={styles.type}>{ORG_TYPE[organizer.orgType]}</span>}
          </span>
        ) : (
          <span className={styles.trust}>
            <User size={18} aria-hidden />
            Встреча частного лица
          </span>
        )}
        {!compact && <span className={styles.facts}>{factsText}</span>}
      </div>
    </div>
  );
}
