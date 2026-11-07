import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { useOne } from '@refinedev/core';
import { Modal } from 'antd';

import { Avatar, ErrorState, SkeletonText, SportIcon } from '@/components';
import { dayjs } from '@/lib/dates';
import { SKILL_LEVEL } from '@/lib/labels';
import type { UserView } from '@/types/api';

import { ageText } from '../../event/company/labels';
import styles from './review.module.css';

interface ProfileSheetProps {
  /** Чей профиль показать; null — окно закрыто. */
  person: { id: string; name: string } | null;
  onClose: () => void;
}

/** Профиль заявителя поверх стопки: стопка и позиция в ней остаются на месте. */
export function ProfileSheet({ person, onClose }: ProfileSheetProps) {
  return (
    <Modal
      open={person !== null}
      onCancel={onClose}
      title={person ? `Профиль: ${person.name}` : 'Профиль'}
      footer={null}
      width={520}
      destroyOnHidden
    >
      {person && <ProfileBody id={person.id} />}
    </Modal>
  );
}

function ProfileBody({ id }: { id: string }) {
  const { result: user, query } = useOne<UserView>({ resource: 'users', id });
  if (query.isLoading) {
    return (
      <div role="status" className={styles.profileBody}>
        <span className="sr-only">Загружаем профиль…</span>
        <SkeletonText lines={4} />
      </div>
    );
  }
  if (query.isError || !user) {
    return (
      <ErrorState onRetry={() => void query.refetch()}>
        Не удалось загрузить профиль. Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    );
  }
  const place = [user.city, user.districtName].filter(Boolean).join(', ');
  const since = dayjs(user.createdAt).format('D MMMM YYYY');
  return (
    <div className={styles.profileBody}>
      <div className={styles.who}>
        <Avatar name={user.name} initials={user.initials} src={user.avatarUrl} size={56} />
        <div className={styles.whoText}>
          <p className={styles.profileFacts}>
            {[user.age !== null ? ageText(user.age) : null, place || null].filter(Boolean).join(' · ')}
          </p>
          <p className={styles.profileFacts}>
            На платформе с {since}. Встреч: {user.facts.attended}
          </p>
        </div>
      </div>
      {user.about ? (
        <p className={styles.profileAbout}>{user.about}</p>
      ) : (
        <p className={styles.profileFacts}>О себе пока ничего не написано.</p>
      )}
      {user.interests.length > 0 && (
        <ul className={styles.interests} aria-label="Спортивные интересы">
          {user.interests.map((sport) => (
            <li key={sport.id}>
              <SportIcon sport={sport} size={18} />
              <span>
                {sport.name}
                {user.levels[sport.id] ? `, ${SKILL_LEVEL[user.levels[sport.id]!].toLowerCase()}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <a className={styles.profileLink} href={`/profile/${user.id}`} target="_blank" rel="noopener">
        Открыть полный профиль в новой вкладке
        <ArrowSquareOutIcon size={18} aria-hidden />
      </a>
    </div>
  );
}
