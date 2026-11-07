import { ArrowSquareOutIcon, CopyIcon, InfoIcon } from '@phosphor-icons/react';
import { useList, useOne } from '@refinedev/core';
import { useState } from 'react';
import { Link, useParams } from 'react-router';

import {
  AssistantFlag,
  AssistantMark,
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  GoneState,
  PageHeader,
  PageSkeleton,
  Section,
  SportIcon,
  StatusBadge,
} from '@/components';
import { API, useAction, type ApiError } from '@/lib/api';
import { formatAgo, formatEventDate } from '@/lib/dates';
import type { AuditView, EventView, OrganizationView } from '@/types/api';
import type { District, OrganizationReview } from '@/types/domain';

import { AdminTable, type AdminColumn } from './parts/AdminTable';
import { DecisionModal } from './parts/DecisionModal';
import styles from './parts/admin.module.css';
import { REJECT_TEMPLATES, RETURN_TEMPLATES, submittedAt, quoted } from './parts/labels';
import { OrgStopListSection } from './stoplist/OrgStopListSection';
import { OrgSuspendPanel } from './suspension/OrgSuspendPanel'; // С17

type Decision = 'approve' | 'reject' | 'return';

const REVIEW_ACTION: Record<OrganizationReview['decision'], string> = {
  submitted: '',
  approved: 'org.approve',
  rejected: 'org.reject',
  returned: 'org.return',
};

const REVIEW_LABEL: Record<OrganizationReview['decision'], string> = {
  submitted: 'Заявка отправлена на проверку',
  approved: 'Допущена',
  rejected: 'Отклонена',
  returned: 'Возвращена на доработку',
};

export default function AdminOrganizationPage() {
  const { id = '' } = useParams();
  const { result: org, query } = useOne<OrganizationView>({ resource: 'organizations', id });
  const { result: districts } = useList<District>({ resource: 'districts', pagination: { mode: 'off' } });
  const { result: events, query: eventsQuery } = useList<EventView>({
    resource: 'events',
    filters: [
      { field: 'scope', operator: 'eq', value: 'org' },
      { field: 'orgId', operator: 'eq', value: id },
    ],
    pagination: { mode: 'off' },
  });
  const { result: auditRes } = useList<AuditView>({
    resource: 'audit',
    filters: [{ field: 'targetType', operator: 'eq', value: 'org' }],
    pagination: { mode: 'off' },
  });
  const { run } = useAction();
  const [decision, setDecision] = useState<Decision | null>(null);

  if (query.isLoading) return <PageSkeleton />;
  if (query.isError || !org) {
    const notFound = (query.error as ApiError | null)?.statusCode === 404;
    return (
      <div className={styles.page}>
        <PageHeader title="Организация" back={{ to: '/admin/organizations', label: 'Все организации' }} />
        {notFound ? (
          <GoneState
            title="Такой организации нет"
            layout="inline"
            actions={
              <Button variant="secondary" to="/admin/organizations">
                К списку организаций
              </Button>
            }
          >
            Возможно, ссылка устарела. Найдите организацию по названию в списке.
          </GoneState>
        ) : (
          <ErrorState title="Не удалось загрузить заявку" onRetry={() => void query.refetch()} />
        )}
      </div>
    );
  }

  const district = districts?.data.find((d) => d.id === org.districtId)?.name;
  const decisions = (auditRes?.data ?? []).filter((a) => a.targetId === org.id);
  const adminName = (r: OrganizationReview) =>
    decisions.find(
      (a) => a.action === REVIEW_ACTION[r.decision] && Math.abs(Date.parse(a.at) - Date.parse(r.at)) < 60_000,
    )?.actorName ?? 'администратор';
  const lastDecision = [...org.reviews].reverse().find((r) => r.decision !== 'submitted');
  const contacts = [org.contacts.phone, org.contacts.email, org.contacts.social].filter(Boolean);

  const decide =
    (d: Decision) =>
    async ({ reason }: { reason: string }) =>
      run(
        API.decideOrganization(org.id),
        { decision: d, reason },
        {
          success: {
            approve: 'Организация допущена. Представитель получил уведомление',
            reject: 'Заявка отклонена. Представитель увидит причину',
            return: 'Заявка возвращена на доработку',
          }[d],
        },
      );

  const eventColumns: AdminColumn<EventView>[] = [
    {
      key: 'title',
      title: 'Событие',
      primary: true,
      render: (e) => (
        <div className={styles.nameCell}>
          <Link to={`/admin/events/${e.id}`} className={styles.nameLink}>
            {e.title}
          </Link>
          <span className={[styles.sub, styles.inlineIcon].join(' ')}>
            <SportIcon sport={e.sport} size={18} />
            {e.sport.name}
          </span>
        </div>
      ),
    },
    { key: 'when', title: 'Когда', width: 260, render: (e) => formatEventDate(e.startsAt) },
    {
      key: 'state',
      title: 'Состояние',
      width: 230,
      render: (e) => <StatusBadge kind="event" status={e.state} />,
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        back={{ to: '/admin/organizations', label: 'Все организации' }}
        context={org.typeLabel}
        title={org.name}
      />
      <div className={[styles.headBadges, styles.pageHead].join(' ')}>
        <StatusBadge kind="org" status={org.status} size="lg" />
        {org.createdWithAssistant && (
          <AssistantMark why="Заявку заполняли в режиме «Создать с помощником»." />
        )}
      </div>

      {org.aiFlag !== 'none' && <AssistantFlag flag={org.aiFlag} reason={org.aiReason} />}

      <div className={styles.detail}>
        <aside className={[styles.aside, styles.asideFirst].join(' ')} aria-label="Решение по заявке">
          <DecisionPanel
            org={org}
            lastDecisionAt={lastDecision?.at ?? null}
            lastReason={lastDecision?.reason ?? ''}
            onDecide={setDecision}
          />
          {/* С17: приостановка допуска */}
          <OrgSuspendPanel org={org} />
        </aside>

        <div className={styles.main}>
          {org.similar.length > 0 && (
            <p className={[styles.note, styles.warnNote].join(' ')}>
              <CopyIcon size={20} aria-hidden />
              <span>
                Похожие названия на платформе: {org.similar.map((n) => `«${n}»`).join(', ')}. Проверьте, не
                повторная ли это заявка.
              </span>
            </p>
          )}

          <Section title="Сведения">
            <dl className={styles.facts}>
              <dt>Тип</dt>
              <dd>{org.typeLabel}</dd>
              <dt>Чем занимается</dt>
              <dd className={styles.prose}>
                {org.description || <span className={styles.empty}>Не заполнено</span>}
              </dd>
              <dt>Направления</dt>
              <dd>
                {org.sports.length ? (
                  <span className={styles.chips}>
                    {org.sports.map((s) => (
                      <span key={s.id} className={styles.tag}>
                        <SportIcon sport={s} size={18} />
                        {s.name}
                      </span>
                    ))}
                  </span>
                ) : (
                  <span className={styles.empty}>Не указаны</span>
                )}
              </dd>
              <dt>Где</dt>
              <dd>
                {[org.city, district && !org.address.includes(district) ? district : '', org.address]
                  .filter(Boolean)
                  .join(', ') || <span className={styles.empty}>Адрес не указан</span>}
              </dd>
              <dt>Контакты</dt>
              <dd>
                {contacts.length ? (
                  <span className={styles.stackList}>
                    {org.contacts.phone && <span>Телефон: {org.contacts.phone}</span>}
                    {org.contacts.email && <span>Почта: {org.contacts.email}</span>}
                    {org.contacts.social && <span>Соцсети: {org.contacts.social}</span>}
                  </span>
                ) : (
                  <span className={styles.empty}>Не указаны</span>
                )}
              </dd>
              <dt>Заявка подана</dt>
              <dd>{formatAgo(submittedAt(org))}</dd>
              <dt>Проведено встреч</dt>
              <dd>
                {org.facts.held}, отменено {org.facts.cancelled}, впереди {org.facts.upcoming}
              </dd>
            </dl>
          </Section>

          <Section title="Представитель">
            {org.owner ? (
              <div className={styles.person}>
                <Avatar
                  name={org.owner.name}
                  initials={org.owner.initials}
                  src={org.owner.avatarUrl}
                  size={48}
                />
                <div className={styles.personBody}>
                  <Link to={`/profile/${org.owner.id}`} className={styles.nameLink}>
                    {org.owner.name}
                  </Link>
                  <span className={styles.sub}>Управляет организацией на платформе</span>
                </div>
              </div>
            ) : (
              <p className={styles.empty}>Представитель не указан</p>
            )}
          </Section>

          <Section title="История решений" aside={org.reviews.length}>
            <ol className={styles.timeline}>
              {[...org.reviews].reverse().map((r) => (
                <li key={r.id} className={styles.timelineItem}>
                  <span className={styles.timelineDot} aria-hidden />
                  <div className={styles.timelineBody}>
                    <div className={styles.timelineHead}>
                      <strong>{REVIEW_LABEL[r.decision]}</strong>
                      <time className={styles.sub} dateTime={r.at}>
                        {formatAgo(r.at)}
                      </time>
                    </div>
                    {r.decision !== 'submitted' && (
                      <span className={styles.sub}>Кто решил: {adminName(r)}</span>
                    )}
                    {r.reason && <p className={styles.prose}>{r.reason}</p>}
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <OrgStopListSection orgId={org.id} />

          <Section title="События организации" aside={events?.data.length ?? undefined}>
            {eventsQuery.isError ? (
              <ErrorState title="Не удалось загрузить события" onRetry={() => void eventsQuery.refetch()} />
            ) : (
              <AdminTable
                caption="События организации"
                rows={events?.data ?? []}
                rowKey={(e) => e.id}
                columns={eventColumns}
                loading={eventsQuery.isLoading}
                rowLink={(e) => `/admin/events/${e.id}`}
                pageSize={10}
                empty={
                  <EmptyState title="Событий нет">
                    {org.status === 'approved'
                      ? 'Организация пока ничего не публиковала.'
                      : 'До допуска организация не может публиковать события от своего имени.'}
                  </EmptyState>
                }
              />
            )}
          </Section>
        </div>
      </div>

      <DecisionModal
        open={decision === 'approve'}
        title={`Допустить ${quoted(org.name)}?`}
        confirmLabel="Допустить"
        consequences={[
          'Представитель получит уведомление, в кабинете статус сменится на «Допущена».',
          'Откроется публичная страница организации.',
          'События от имени организации будут сразу появляться в поиске, без согласования.',
        ]}
        onConfirm={decide('approve')}
        onClose={() => setDecision(null)}
      />
      <DecisionModal
        open={decision === 'reject'}
        title={`Отклонить заявку: ${org.name}?`}
        confirmLabel="Отклонить заявку"
        confirmTone="danger"
        consequences={[
          'Представитель увидит причину в кабинете и в уведомлении.',
          'Публиковать события от имени организации будет нельзя.',
          'Организация сможет исправить заявку и отправить её снова.',
        ]}
        reason={{
          label: 'Причина отказа',
          hint: 'Напишите так, чтобы было понятно, что исправить. Причину увидит организация.',
          required: true,
          templates: REJECT_TEMPLATES,
          placeholder: 'Например: в описании нет ни слова о занятиях',
        }}
        onConfirm={decide('reject')}
        onClose={() => setDecision(null)}
      />
      <DecisionModal
        open={decision === 'return'}
        title={`Вернуть на доработку: ${org.name}?`}
        confirmLabel="Вернуть на доработку"
        consequences={[
          'Представитель увидит, что нужно исправить, в кабинете и в уведомлении.',
          'Заявка уйдёт из очереди, пока её не отправят снова.',
        ]}
        reason={{
          label: 'Что исправить',
          hint: 'Это не отказ: после правок заявка вернётся к вам.',
          required: true,
          templates: RETURN_TEMPLATES,
          placeholder: 'Например: укажите адрес зала',
        }}
        onConfirm={decide('return')}
        onClose={() => setDecision(null)}
      />
    </div>
  );
}

function DecisionPanel({
  org,
  lastDecisionAt,
  lastReason,
  onDecide,
}: {
  org: OrganizationView;
  lastDecisionAt: string | null;
  lastReason: string;
  onDecide: (d: Decision) => void;
}) {
  if (org.status === 'pending') {
    return (
      <section className={styles.panel}>
        <h2 className={styles.panelTitle}>Решение по заявке</h2>
        <p className={styles.panelText}>
          Заявку отправили {formatAgo(submittedAt(org))}. Решение и причину увидит представитель.
        </p>
        <div className={styles.panelActions}>
          <Button variant="primary" block onClick={() => onDecide('approve')}>
            Допустить
          </Button>
          <Button variant="secondary" block onClick={() => onDecide('return')}>
            Вернуть на доработку
          </Button>
          <Button variant="secondary" block onClick={() => onDecide('reject')}>
            Отклонить
          </Button>
        </div>
      </section>
    );
  }

  const when = lastDecisionAt ? formatAgo(lastDecisionAt) : null;
  const texts: Record<Exclude<OrganizationView['status'], 'pending'>, { title: string; text: string }> = {
    approved: {
      title: 'Организация допущена',
      text: `${when ? `Допущена ${when}. ` : ''}Организация публикует события без согласования. Если событие нарушает правила, его можно снять в разделе «События».`,
    },
    rejected: {
      title: 'Заявка отклонена',
      text: `${when ? `Отклонили ${when}. ` : ''}Когда организация исправит заявку и отправит снова, она вернётся в очередь.`,
    },
    returned: {
      title: 'Заявка на доработке',
      text: `${when ? `Вернули ${when}. ` : ''}Когда организация исправит заявку, она вернётся в очередь.`,
    },
    draft: {
      title: 'Заявка ещё не отправлена',
      text: 'Представитель сохранил черновик. Решать пока нечего.',
    },
    blocked: {
      title: 'Организация заблокирована',
      text: 'Её страница и события скрыты.',
    },
  };
  const t = texts[org.status];
  return (
    <section className={styles.panel}>
      <h2 className={styles.panelTitle}>{t.title}</h2>
      <p className={styles.panelText}>{t.text}</p>
      {lastReason && (org.status === 'rejected' || org.status === 'returned') && (
        <p className={styles.note}>
          <InfoIcon size={20} aria-hidden />
          <span>Организация видит причину: {lastReason}</span>
        </p>
      )}
      {org.status === 'approved' && (
        <Button
          variant="secondary"
          block
          to={`/orgs/${org.id}`}
          icon={<ArrowSquareOutIcon size={20} aria-hidden />}
        >
          Открыть страницу организации
        </Button>
      )}
    </section>
  );
}
