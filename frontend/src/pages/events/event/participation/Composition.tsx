import { GenderFemaleIcon, GenderMaleIcon, UserCircleIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components';
import { useMe } from '@/lib/api';
import { COMPOSITION } from '@/lib/labels';
import type { EventView } from '@/types/api';
import type { Composition } from '@/types/domain';

import { GenderDialog } from '../../../profile/gender/GenderDialog';
import { Tag } from '../../feed/FeedCard';
import styles from './participation.module.css';

const FOR_WHOM: Record<Exclude<Composition, 'mixed'>, string> = {
  women: 'только для женщин',
  men: 'только для мужчин',
};

function CompositionIcon({ composition, size }: { composition: Composition; size: number }) {
  if (composition === 'women') return <GenderFemaleIcon size={size} weight="bold" aria-hidden />;
  if (composition === 'men') return <GenderMaleIcon size={size} weight="bold" aria-hidden />;
  return <UsersThreeIcon size={size} aria-hidden />;
}

/** В7: метка «Только женщины» / «Только мужчины». У смешанного состава метки нет. */
export function CompositionTag({ composition }: { composition?: Composition }) {
  const tag = composition ? COMPOSITION[composition].tag : null;
  if (!composition || !tag) return null;
  return (
    <Tag tone="plain" icon={<CompositionIcon composition={composition} size={14} />}>
      {tag}
    </Tag>
  );
}

/**
 * В7: почему записаться нельзя по составу. Кто не указал пол — указывает его здесь же,
 * и запись продолжается сама. Кому встреча не подходит — спокойное объяснение и похожие встречи.
 */
export function CompositionNote({ event: e, onContinue }: { event: EventView; onContinue: () => void }) {
  const { me } = useMe();
  const [open, setOpen] = useState(false);
  const composition = e.composition ?? 'mixed';
  if (!me || composition === 'mixed') return null;
  const forWhom = FOR_WHOM[composition];
  const needsGender = !me.gender;

  return (
    <div className={[styles.note, styles['note-off']].join(' ')}>
      <p className={styles.noteTitle}>
        <CompositionIcon composition={composition} size={20} />
        Встреча {forWhom}
      </p>
      <div className={styles.noteText}>
        {needsGender ? (
          <p>Чтобы записаться, укажите в профиле пол. Его видите только вы.</p>
        ) : (
          <p>
            Организатор собирает эту встречу {forWhom}.{' '}
            <Link to={`/events?sport=${e.sportId}&who=mixed`}>Похожие встречи для всех</Link>
          </p>
        )}
      </div>
      {needsGender && (
        <div className={styles.actions}>
          <Button
            variant="primary"
            size="lg"
            icon={<UserCircleIcon size={20} aria-hidden />}
            onClick={() => setOpen(true)}
          >
            Указать в профиле
          </Button>
        </div>
      )}
      {needsGender && (
        <GenderDialog
          me={me}
          open={open}
          title={`Встреча ${forWhom}`}
          onClose={() => setOpen(false)}
          onSaved={(gender) => {
            setOpen(false);
            if (gender) onContinue();
          }}
        />
      )}
    </div>
  );
}
