import { BuildingsIcon } from '@phosphor-icons/react';
import { useCreate } from '@refinedev/core';
import { Link, useNavigate } from 'react-router';

import { PageSkeleton, StatusBadge } from '@/components';
import { useMe } from '@/lib/api';
import type { OrganizationView } from '@/types/api';

import { OrgEditor } from './parts/OrgEditor';
import { EMPTY_VALUES } from './parts/formModel';
import styles from './parts/OrgPages.module.css';
import { PersonalPage } from '../shared/PersonalPage';

export default function OrgCreatePage() {
  const { me, isLoading } = useMe();
  const navigate = useNavigate();
  const { mutateAsync } = useCreate<OrganizationView>();

  if (isLoading || !me)
    return (
      <div className="container">
        <PageSkeleton />
      </div>
    );

  return (
    <PersonalPage
      title="Ваша организация"
      description="Для клубов, секций, школ и тренеров. После проверки встречи можно проводить от имени организации."
      icon={<BuildingsIcon size={28} />}
      summary={
        <>
          <strong>Проверка занимает до одного дня</strong>Пока заявка на проверке, встречи можно создавать от
          себя.
        </>
      }
    >
      {me.orgs.length > 0 && (
        <div className={styles.existing}>
          <BuildingsIcon size={22} aria-hidden />
          <div className={styles.existingBody}>
            <p>У вас уже есть организация. Если хотите изменить её данные, откройте кабинет.</p>
            <ul className={styles.existingList}>
              {me.orgs.map((o) => (
                <li key={o.id}>
                  <Link to={`/org/${o.id}`}>{o.name}</Link>
                  <StatusBadge kind="org" status={o.status} />
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <OrgEditor
        me={me}
        purpose="create"
        initial={EMPTY_VALUES}
        draftKey={`vmeste.orgDraft.${me.id}`}
        onSubmit={async (input) => {
          const res = await mutateAsync({
            resource: 'organizations',
            values: { ...input, submit: true },
            successNotification: false,
            errorNotification: false,
          });
          navigate(`/org/${res.data.id}`);
        }}
      />
    </PersonalPage>
  );
}
