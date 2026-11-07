import { ProhibitIcon } from '@phosphor-icons/react';

import { Button, NoAccessState, StopListTable, useStopList } from '@/components';
import { useMe } from '@/lib/api';

import { PersonalPage } from '../../shared/PersonalPage';

/** D-16: личный стоп-лист — кого человек не пускает на встречи, которые проводит от своего имени. */
export default function StopListPage() {
  const { me, role } = useMe();
  const owner = me && role !== 'admin' ? (`user:${me.id}` as const) : null;
  const { active } = useStopList(owner);

  if (role === 'admin') {
    return (
      <div className="container">
        <NoAccessState
          title="У администратора нет своего стоп-листа"
          actions={
            <Button variant="primary" to="/admin">
              К администрированию
            </Button>
          }
        >
          Стоп-листы ведут организаторы. Записи из них видны в карточке организации и в профиле человека в
          администрировании.
        </NoAccessState>
      </div>
    );
  }

  return (
    <PersonalPage
      title="Стоп-лист"
      description="Люди, которых вы не пускаете на встречи, которые проводите от своего имени."
      icon={<ProhibitIcon size={28} />}
      value={active}
      summary={
        <>
          <strong>Действует сейчас</strong>У встреч клуба свой стоп-лист, он в кабинете клуба.
        </>
      }
      actions={
        <Button variant="secondary" to="/me?tab=organizing">
          К моим занятиям
        </Button>
      }
    >
      {owner && <StopListTable owner={owner} />}
    </PersonalPage>
  );
}
