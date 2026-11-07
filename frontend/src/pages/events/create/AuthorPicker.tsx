import { BuildingsIcon, UserIcon } from '@phosphor-icons/react';
import { Link } from 'react-router';

import { StatusBadge } from '@/components';
import type { Identity } from '@/types/api';
import type { OrgStatus } from '@/types/domain';

import { FieldGroup, OptionCards } from './fields';
import styles from './create.module.css';

const BLOCKED_REASON: Record<Exclude<OrgStatus, 'approved'>, string> = {
  draft: 'Заявка организации ещё не отправлена. Публиковать от её имени можно после проверки.',
  pending: 'Организация на проверке, обычно это до одного дня. Пока можно опубликовать от себя.',
  rejected: 'Заявку отклонили. Исправьте её в кабинете и отправьте снова.',
  returned: 'Заявку вернули на доработку. Поправьте её в кабинете.',
  blocked: 'Организация заблокирована. Публиковать от её имени нельзя.',
};

/** «От себя» или «от организации». Недопущенная организация видна, но выбрать её нельзя, и сказано почему. */
export function AuthorPicker({
  me,
  value,
  onChange,
  locked,
}: {
  me: Identity;
  value: string | null;
  onChange: (orgId: string | null) => void;
  locked?: boolean;
}) {
  if (!me.orgs.length) return null;
  const current = me.orgs.find((o) => o.id === value);
  if (locked) {
    return (
      <p className={styles.authorLocked}>
        {current ? <BuildingsIcon size={20} aria-hidden /> : <UserIcon size={20} aria-hidden />}
        Организатор: <strong>{current ? current.name : `${me.name}, от себя`}</strong>
      </p>
    );
  }
  return (
    <FieldGroup legend="От чьего имени публикуем">
      <OptionCards<string>
        label="От чьего имени публикуем"
        columns={me.orgs.length > 1 ? 3 : 2}
        size="sm"
        value={value ?? 'self'}
        onChange={(v) => onChange(v === 'self' ? null : v)}
        options={[
          {
            value: 'self',
            title: 'От себя',
            text: `${me.name}. В карточке будет метка «Встреча частного лица»`,
            icon: <UserIcon size={20} aria-hidden />,
          },
          ...me.orgs.map((o) => ({
            value: o.id,
            title: `От организации ${o.name}`,
            icon: <BuildingsIcon size={20} aria-hidden />,
            disabled: o.status !== 'approved',
            text:
              o.status === 'approved'
                ? 'Опубликуется сразу, с меткой «Организация проверена»'
                : BLOCKED_REASON[o.status],
            after:
              o.status !== 'approved' ? (
                <div className={styles.authorAfter}>
                  <StatusBadge kind="org" status={o.status} />
                  <Link to={`/org/${o.id}`} className={styles.inlineLink}>
                    Открыть кабинет организации
                  </Link>
                </div>
              ) : null,
          })),
        ]}
      />
    </FieldGroup>
  );
}
