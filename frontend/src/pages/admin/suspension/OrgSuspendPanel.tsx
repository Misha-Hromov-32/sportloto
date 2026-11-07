import { PauseCircleIcon, PlayCircleIcon } from '@phosphor-icons/react';
import { useState } from 'react';

import { Button } from '@/components';
import { COMMUNITY_API, useAction } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import type { OrganizationView } from '@/types/api';

import { DecisionModal } from '../parts/DecisionModal';
import styles from '../parts/admin.module.css';

const SUSPEND_TEMPLATES = [
  'Жалобы участников на предоплату за встречи.',
  'Встречи не проходят: участники приходят, а организатора нет.',
  'Публикуют рекламу вместо совместных занятий.',
];

/** С17: приостановить и возобновить допуск уже допущенной организации. */
export function OrgSuspendPanel({ org }: { org: OrganizationView }) {
  const [open, setOpen] = useState<'suspend' | 'resume' | null>(null);
  const { run } = useAction();
  if (org.status !== 'approved') return null;
  const s = org.suspension;

  return (
    <section className={styles.panel} aria-labelledby="suspend-title">
      <h2 id="suspend-title" className={styles.panelTitle}>
        {s ? 'Допуск приостановлен' : 'Допуск'}
      </h2>
      {s ? (
        <>
          <p className={[styles.note, styles.warnNote].join(' ')}>
            <PauseCircleIcon size={20} aria-hidden />
            <span>
              Приостановлен {formatAgo(s.at)}. {s.reason} Новые встречи не публикуются, опубликованные остаются.
            </span>
          </p>
          <Button variant="primary" block icon={<PlayCircleIcon size={20} aria-hidden />} onClick={() => setOpen('resume')}>
            Возобновить допуск
          </Button>
        </>
      ) : (
        <>
          <p className={styles.panelText}>
            Если организация нарушает правила, приостановите допуск: страница останется, но новые встречи от её имени
            публиковать будет нельзя.
          </p>
          <Button variant="secondary" block icon={<PauseCircleIcon size={20} aria-hidden />} onClick={() => setOpen('suspend')}>
            Приостановить допуск
          </Button>
        </>
      )}

      <DecisionModal
        open={open === 'suspend'}
        title={`Приостановить допуск «${org.name}»?`}
        confirmLabel="Приостановить допуск"
        confirmTone="danger"
        consequences={[
          'Новые встречи от имени организации публиковать будет нельзя.',
          'Опубликованные встречи и записи на них останутся.',
          'На странице организации появится пометка, представитель получит уведомление с причиной.',
        ]}
        reason={{
          label: 'Причина',
          hint: 'Её увидит представитель организации. Остальные увидят только пометку.',
          required: true,
          templates: SUSPEND_TEMPLATES,
        }}
        onConfirm={(v) => run(COMMUNITY_API.suspendOrg(org.id), { reason: v.reason }, { success: 'Допуск приостановлен' })}
        onClose={() => setOpen(null)}
      />
      <DecisionModal
        open={open === 'resume'}
        title={`Возобновить допуск «${org.name}»?`}
        confirmLabel="Возобновить допуск"
        consequences={['Организация снова сможет публиковать встречи.', 'Пометка со страницы пропадёт, представитель получит уведомление.']}
        reason={{ label: 'Комментарий для представителя', required: false }}
        onConfirm={(v) => run(COMMUNITY_API.resumeOrg(org.id), { reason: v.reason }, { success: 'Допуск возобновлён' })}
        onClose={() => setOpen(null)}
      />
    </section>
  );
}
