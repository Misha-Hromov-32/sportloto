import {
  ArrowsClockwiseIcon,
  CalendarPlusIcon,
  EyeIcon,
  PencilSimpleIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import type { CSSProperties } from 'react';

import { Button, StatusBadge } from '@/components';
import { formatAgo, formatDayMonth } from '@/lib/dates';
import type { OrganizationView } from '@/types/api';
import type { OrgStatus } from '@/types/domain';

import styles from './StatusPanel.module.css';

interface StatusPanelProps {
  org: OrganizationView;
  /** Статус только что сменился живым обновлением: подсветить и сказать об этом. */
  justChanged: boolean;
  onEdit: () => void;
}

const TONE: Record<OrgStatus, string> = {
  draft: styles.neutral!,
  pending: styles.wait!,
  returned: styles.wait!,
  approved: styles.ok!,
  rejected: styles.danger!,
  blocked: styles.danger!,
};

const FLASH: Record<OrgStatus, string> = {
  draft: 'var(--ink-2)',
  pending: 'var(--wait)',
  returned: 'var(--wait)',
  approved: 'var(--ok)',
  rejected: 'var(--danger)',
  blocked: 'var(--danger)',
};

function lastOf(org: OrganizationView, decision: OrganizationView['reviews'][number]['decision']) {
  return [...org.reviews].reverse().find((r) => r.decision === decision) ?? null;
}

/** Главный блок кабинета: где заявка сейчас, что это значит и что делать дальше. */
export function StatusPanel({ org, justChanged, onEdit }: StatusPanelProps) {
  const submitted = lastOf(org, 'submitted');
  const decision = org.lastReview && org.lastReview.decision !== 'submitted' ? org.lastReview : null;

  return (
    <section
      className={[styles.panel, TONE[org.status], justChanged && 'status-flash'].filter(Boolean).join(' ')}
      style={{ '--flash-color': FLASH[org.status] } as CSSProperties}
      aria-labelledby="org-status-title"
    >
      <div className={styles.head}>
        <StatusBadge kind="org" status={org.status} size="lg" />
        {justChanged && (
          <span className={styles.live}>
            <ArrowsClockwiseIcon size={18} aria-hidden />
            Обновлено только что
          </span>
        )}
      </div>

      {org.status === 'pending' && (
        <>
          <h2 id="org-status-title" className={styles.title}>
            Заявку проверяет администратор
          </h2>
          <p className={styles.lead}>
            {submitted ? `Отправлена ${formatAgo(submitted.at)}. ` : ''}Обычно проверка занимает до одного
            дня. Решение появится здесь само, обновлять страницу не нужно, и придёт в уведомления.
          </p>
          <div className={styles.columns}>
            <div className={styles.column}>
              <h3 className={styles.subtitle}>Что проверяют</h3>
              <ul className={styles.list}>
                <li>По описанию понятно, что вы проводите, где и для кого.</li>
                <li>С вами можно связаться: есть телефон или почта.</li>
                <li>Название не повторяет другую организацию, а текст не похож на рекламу.</li>
              </ul>
            </div>
            <div className={styles.column}>
              <h3 className={styles.subtitle}>Что можно сейчас</h3>
              <ul className={styles.list}>
                <li>Создавать встречи от себя: они сразу появятся в поиске.</li>
                <li>Посмотреть, как будет выглядеть страница организации.</li>
                <li>Изменить заявку можно будет после решения администратора.</li>
              </ul>
            </div>
          </div>
          <div className={styles.actions}>
            <Button
              variant="primary"
              to="/events/new"
              icon={<PlusIcon size={20} weight="bold" aria-hidden />}
            >
              Создать встречу от себя
            </Button>
            <Button variant="secondary" to={`/orgs/${org.id}`} icon={<EyeIcon size={20} aria-hidden />}>
              Посмотреть страницу
            </Button>
          </div>
        </>
      )}

      {(org.status === 'rejected' || org.status === 'returned') && (
        <>
          <h2 id="org-status-title" className={styles.title}>
            {org.status === 'rejected' ? 'Администратор отклонил заявку' : 'Заявку вернули на доработку'}
          </h2>
          <div className={styles.reason}>
            <p className={styles.reasonLabel}>{org.status === 'rejected' ? 'Причина' : 'Что исправить'}</p>
            <p className={styles.reasonText}>{decision?.reason || 'Администратор не указал причину.'}</p>
            {decision && <p className={styles.reasonMeta}>Решение от {formatDayMonth(decision.at)}</p>}
          </div>
          <p className={styles.lead}>
            Исправьте заявку и отправьте её снова: администратор проверит её заново, обычно до одного дня.
            Встречи от себя можно создавать и сейчас.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={onEdit} icon={<PencilSimpleIcon size={20} aria-hidden />}>
              Исправить и отправить снова
            </Button>
            <Button variant="secondary" to="/events/new" icon={<PlusIcon size={20} aria-hidden />}>
              Создать встречу от себя
            </Button>
          </div>
        </>
      )}

      {org.status === 'approved' && (
        <>
          <h2 id="org-status-title" className={styles.title}>
            Организация допущена
          </h2>
          <p className={styles.lead}>
            {decision ? `С ${formatDayMonth(decision.at)} страница` : 'Страница'} «{org.name}» открыта для
            всех. Встречи от имени организации публикуются сразу, без повторной проверки.
          </p>
          <div className={styles.actions}>
            <Button
              variant="primary"
              to={`/events/new?org=${org.id}`}
              icon={<CalendarPlusIcon size={20} aria-hidden />}
            >
              Создать встречу от имени организации
            </Button>
            <Button variant="secondary" to={`/orgs/${org.id}`} icon={<EyeIcon size={20} aria-hidden />}>
              Открыть публичную страницу
            </Button>
          </div>
        </>
      )}

      {org.status === 'draft' && (
        <>
          <h2 id="org-status-title" className={styles.title}>
            Заявка ещё не отправлена
          </h2>
          <p className={styles.lead}>
            Администратор увидит заявку, когда вы её отправите. До этого страница организации никому не видна.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" onClick={onEdit} icon={<PencilSimpleIcon size={20} aria-hidden />}>
              Заполнить и отправить
            </Button>
          </div>
        </>
      )}

      {org.status === 'blocked' && (
        <>
          <h2 id="org-status-title" className={styles.title}>
            Организация заблокирована
          </h2>
          <p className={styles.lead}>
            Страница организации скрыта, публиковать встречи от её имени нельзя. Встречи от себя можно
            создавать как обычно.
          </p>
        </>
      )}
    </section>
  );
}
