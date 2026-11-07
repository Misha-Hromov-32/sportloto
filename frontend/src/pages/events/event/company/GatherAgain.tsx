import { Modal } from 'antd';
import { useState } from 'react';
import { Button, ErrorState } from '@/components';
import { API, useLiveGet } from '@/lib/api';
import type { AgainPreview, EventDetails } from '@/types/api';
import styles from './Company.module.css';

export function GatherAgain({ event: e }: { event: EventDetails }) {
  const [open, setOpen] = useState(false);
  const enabled = e.isOrganizer && e.state === 'past';
  const { data, isLoading, isError, refetch } = useLiveGet<AgainPreview>(
    API.again(e.id),
    ['participations', 'demo'],
    enabled && open,
  );
  if (!enabled) return null;
  return (
    <section className={styles.panel}>
      <h2>Повторим?</h2>
      <p>
        Создайте новую встречу с теми же условиями. Участникам прошлой встречи придут приглашения после
        публикации.
      </p>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Собраться снова
      </Button>
      <Modal
        title="Кого позовём снова"
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          data ? (
            <Button variant="primary" to={`/events/new?from=${e.id}&again=1`}>
              Выбрать дату и создать
            </Button>
          ) : null
        }
        loading={isLoading}
      >
        {isError ? (
          <ErrorState onRetry={() => void refetch()} />
        ) : (
          <div className={styles.stack}>
            <p>Никого не записываем автоматически. Каждый решит сам.</p>
            <ul>
              {data?.invitees.map((p) => (
                <li key={p.id}>{p.name}</li>
              ))}
            </ul>
            {data && !data.invitees.length && (
              <p>Подтверждённых участников не было. Можно создать встречу и пригласить новых людей.</p>
            )}
          </div>
        )}
      </Modal>
    </section>
  );
}
