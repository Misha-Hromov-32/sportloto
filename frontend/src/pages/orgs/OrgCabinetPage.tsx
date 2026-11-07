import { BuildingsIcon, PencilSimpleIcon } from '@phosphor-icons/react';
import { useList, useOne, useUpdate } from '@refinedev/core';
import { App } from 'antd';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { Button, ErrorState, GoneState, NoAccessState, PageSkeleton } from '@/components';
import { PersonalPage } from '../shared/PersonalPage';
import { API, useAction, useMe, type ApiError } from '@/lib/api';
import { ORG_STATUS } from '@/lib/labels';
import type { EventView, OrganizationView } from '@/types/api';
import type { OrgStatus } from '@/types/domain';

import { Applications, OrgEvents, OrgStats, ReviewHistory } from './parts/CabinetParts';
import { OrgEditor } from './parts/OrgEditor';
import { valuesFromOrg } from './parts/formModel';
import styles from './parts/OrgPages.module.css';
import { StatusPanel } from './parts/StatusPanel';
import { VenueCabinet } from '../venues/cabinet/VenueCabinet'; // В4
import { OrgSupportPanel } from './needs/OrgSupportPanel'; // В3 + С7
import { CabinetTabs } from './demand/DemandTab'; // С2
import { SuspensionNotice } from './suspension/SuspensionNotice'; // С17
import { OrgStopList } from './stop-list/StopListTab'; // D-16
import { ManagersPanel } from './managers/ManagersPanel';

interface Seen {
  id: string | null;
  status: OrgStatus | null;
  changes: number;
}

export default function OrgCabinetPage() {
  const { id = '' } = useParams();
  const { me } = useMe();
  const [params, setParams] = useSearchParams();
  const editing = params.get('edit') === '1';
  const { message } = App.useApp();
  const { run } = useAction<OrganizationView>();
  const { mutateAsync: update } = useUpdate<OrganizationView>();

  const { query, result: org } = useOne<OrganizationView>({
    resource: 'organizations',
    id,
    errorNotification: false,
    queryOptions: { retry: false },
  });

  const approved = org?.status === 'approved' && (org.isOwner || org.isManager);
  const eventsQuery = useList<EventView>({
    resource: 'events',
    filters: [
      { field: 'scope', operator: 'eq', value: 'org' },
      { field: 'orgId', operator: 'eq', value: id },
    ],
    pagination: { mode: 'off' },
    queryOptions: { enabled: approved },
    errorNotification: false,
  });
  const events = eventsQuery.result.data ?? [];

  // Статус меняет администратор в другой вкладке: отмечаем смену, чтобы подсветить блок и сказать об этом.
  const [seen, setSeen] = useState<Seen>({ id: null, status: null, changes: 0 });
  const [ownChange, setOwnChange] = useState(false);
  if (org && (seen.id !== org.id || seen.status !== org.status)) {
    const external = seen.id === org.id && seen.status !== null && !ownChange;
    setSeen({ id: org.id, status: org.status, changes: external ? seen.changes + 1 : 0 });
    if (ownChange) setOwnChange(false);
  }

  if (query.isLoading)
    return (
      <div className="container">
        <PageSkeleton label="Загружаем кабинет…" />
      </div>
    );

  if (query.isError || !org) {
    const code = (query.error as ApiError | null)?.code;
    if (code === 'not_found')
      return (
        <div className="container">
          <GoneState
            title="Кабинет недоступен"
            actions={
              <>
                <Button variant="primary" to="/events">
                  Найти встречу
                </Button>
                <Button variant="secondary" to="/org/new">
                  Зарегистрировать организацию
                </Button>
              </>
            }
          >
            Такой организации нет, или её кабинет видит только представитель. Сейчас вы вошли как {me?.name}.
            Войдите под учётной записью представителя организации.
          </GoneState>
        </div>
      );
    return (
      <div className="container">
        <ErrorState title="Не удалось загрузить кабинет" layout="page" onRetry={() => void query.refetch()} />
      </div>
    );
  }

  if (!org.isOwner && !org.isManager) {
    return (
      <div className="container">
        <NoAccessState
          title="Кабинет видит только представитель организации"
          actions={
            me?.role === 'admin' ? (
              <Button variant="primary" to={`/admin/organizations/${org.id}`}>
                Открыть заявку в администрировании
              </Button>
            ) : org.status === 'approved' ? (
              <Button variant="primary" to={`/orgs/${org.id}`}>
                Открыть страницу организации
              </Button>
            ) : undefined
          }
        >
          {me?.role === 'admin'
            ? 'Решение по заявке принимается в разделе администрирования.'
            : `Вы вошли как ${me?.name ?? 'гость'}. Кабинет «${org.name}» доступен представителю организации.`}
        </NoAccessState>
      </div>
    );
  }

  const startEdit = () => {
    setParams({ edit: '1' });
    window.scrollTo({ top: 0 });
  };
  const leaveEdit = () => {
    setParams({});
    window.scrollTo({ top: 0 });
  };

  const canEdit = ['draft', 'rejected', 'returned', 'approved'].includes(org.status);

  if (editing && org.isOwner) {
    const resubmit = org.status !== 'approved';
    const lastDecision = org.lastReview && org.lastReview.decision !== 'submitted' ? org.lastReview : null;
    return (
      <PersonalPage
        title={resubmit ? 'Исправить заявку' : 'Изменить сведения'}
        eyebrow="Кабинет организации"
        description={org.name}
        icon={<BuildingsIcon size={28} />}
        summary={
          <>
            <strong>Перед сохранением</strong>Проверьте описание, направления и контакты.
          </>
        }
        actions={
          <Button variant="quiet" onClick={leaveEdit}>
            Вернуться в кабинет
          </Button>
        }
      >
        {!canEdit ? (
          <GoneState
            title="Пока заявка на проверке, изменить её нельзя"
            layout="inline"
            actions={
              <Button variant="secondary" onClick={leaveEdit}>
                Вернуться в кабинет
              </Button>
            }
          >
            Изменить заявку можно будет после решения администратора, обычно до одного дня.
          </GoneState>
        ) : (
          <OrgEditor
            key={org.id}
            me={me!}
            purpose={resubmit ? 'resubmit' : 'edit'}
            initial={valuesFromOrg(org)}
            onCancel={leaveEdit}
            intro={
              resubmit && lastDecision?.reason ? (
                <div className={styles.fixReason}>
                  <p className={styles.fixLabel}>
                    {org.status === 'rejected' ? 'Причина отказа' : 'Что исправить'}
                  </p>
                  <p className={styles.fixText}>{lastDecision.reason}</p>
                </div>
              ) : null
            }
            onSubmit={async (input) => {
              if (resubmit) {
                setOwnChange(true);
                try {
                  await run(API.submitOrganization(org.id), { ...input }, { silent: true });
                } catch (error) {
                  setOwnChange(false);
                  throw error;
                }
              } else {
                await update({
                  resource: 'organizations',
                  id: org.id,
                  values: input,
                  successNotification: false,
                  errorNotification: false,
                });
                message.success('Сведения сохранены');
              }
              leaveEdit();
            }}
          />
        )}
      </PersonalPage>
    );
  }

  return (
    <PersonalPage
      title={org.name}
      eyebrow="Кабинет организации"
      description={
        approved
          ? 'Встречи от имени организации, заявки участников и помощь партнёров.'
          : 'Статус заявки, решения администратора и сведения о вашей организации.'
      }
      icon={<BuildingsIcon size={28} />}
      summary={
        <>
          <strong>{ORG_STATUS[org.status].label}</strong>
          {org.typeLabel}, {org.city}
        </>
      }
      actions={
        org.status === 'approved' && org.isOwner ? (
          <Button variant="quiet" onClick={startEdit} icon={<PencilSimpleIcon size={20} aria-hidden />}>
            Изменить сведения
          </Button>
        ) : undefined
      }
    >
      <p className="sr-only" aria-live="polite">
        {seen.changes > 0 ? `Статус заявки изменился: ${ORG_STATUS[org.status].label}` : ''}
      </p>
      {org.isOwner && (
        <StatusPanel key={seen.changes} org={org} justChanged={seen.changes > 0} onEdit={startEdit} />
      )}
      <SuspensionNotice org={org} />

      {approved && (
        <>
          {/* В4: площадки и свободные окна у организации-площадки */}
          {org.type === 'venue' && org.isOwner && <VenueCabinet org={org} />}
          <OrgStats org={org} events={events} isLoading={eventsQuery.query.isLoading} />
          <Applications events={events} />
          {/* С2: вкладки «Встречи клуба» и «Спрос рядом» */}
          {org.isOwner ? (
            <CabinetTabs
              org={org}
              events={events}
              eventsBlock={
                <OrgEvents
                  org={org}
                  events={events}
                  isLoading={eventsQuery.query.isLoading}
                  isError={eventsQuery.query.isError}
                  onRetry={() => void eventsQuery.query.refetch()}
                />
              }
            />
          ) : (
            <OrgEvents
              org={org}
              events={events}
              isLoading={eventsQuery.query.isLoading}
              isError={eventsQuery.query.isError}
              onRetry={() => void eventsQuery.query.refetch()}
            />
          )}
          {/* В3 + С7: помощь партнёров и вещи организации на полке */}
          {org.isOwner && <OrgSupportPanel org={org} />}
          {/* D-16: общий стоп-лист клуба для владельца и соуправляющих */}
          {(org.isOwner || org.isManager) && <OrgStopList org={org} />}
        </>
      )}

      <ReviewHistory reviews={org.reviews} />
      {(org.isOwner || org.isManager) && <ManagersPanel orgId={org.id} />}
    </PersonalPage>
  );
}
