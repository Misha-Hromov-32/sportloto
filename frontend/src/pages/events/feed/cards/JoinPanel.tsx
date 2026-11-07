import { SignInIcon } from '@phosphor-icons/react';
import { useOne } from '@refinedev/core';
import { Drawer } from 'antd';
import { useEffect, useRef } from 'react';
import { useLocation } from 'react-router';

import { Button, ErrorState, SkeletonText } from '@/components';
import { useMe } from '@/lib/api';
import type { EventDetails, EventView } from '@/types/api';
import type { ParticipationStatus } from '@/types/domain';

import { JoinBox } from '../../event/JoinBox';
import { whenShort } from '../filters';
import styles from './CardsMode.module.css';

const JOINED: ParticipationStatus[] = ['confirmed', 'pending', 'waitlist'];

interface JoinPanelProps {
  event: EventView | null;
  onClose: () => void;
  onJoined: (status: ParticipationStatus) => void;
}

/** Нижняя панель записи: тот же JoinBox, что на странице события, с теми же правилами. */
export function JoinPanel({ event, onClose, onJoined }: JoinPanelProps) {
  const { me } = useMe();
  return (
    <Drawer
      open={Boolean(event)}
      onClose={onClose}
      placement="bottom"
      height="auto"
      destroyOnHidden
      className={styles.drawer}
      title={event ? `${event.joinMode === 'approval' ? 'Заявка на' : 'Записаться на'} «${event.title}»` : ''}
    >
      {event && (
        <div className={styles.panel}>
          <p className={styles.panelWhen}>{whenShort(event.startsAt)}</p>
          {me ? <MemberJoin id={event.id} onJoined={onJoined} /> : <GuestJoin eventId={event.id} />}
        </div>
      )}
    </Drawer>
  );
}

function MemberJoin({ id, onJoined }: { id: string; onJoined: JoinPanelProps['onJoined'] }) {
  const { result: event, query } = useOne<EventDetails>({ resource: 'events', id });
  const status = event?.my?.status ?? null;
  const initial = useRef<ParticipationStatus | null | undefined>(undefined);
  useEffect(() => {
    if (!event) return;
    if (initial.current === undefined) {
      initial.current = status;
      return;
    }
    if (status && JOINED.includes(status) && !JOINED.includes(initial.current as ParticipationStatus))
      onJoined(status);
  }, [event, status, onJoined]);

  if (query.isLoading)
    return (
      <div role="status">
        <span className="sr-only">Загружаем условия записи…</span>
        <SkeletonText lines={4} />
      </div>
    );
  if (query.isError || !event)
    return (
      <ErrorState onRetry={() => void query.refetch()}>
        Не удалось загрузить событие. Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    );
  return <JoinBox event={event} intent={false} onIntentDone={() => undefined} flash={false} />;
}

function GuestJoin({ eventId }: { eventId: string }) {
  const location = useLocation();
  const back = `${location.pathname}${location.search}`;
  return (
    <div className={styles.guest}>
      <p>Чтобы записаться, войдите. Отложенные события сохраним и перенесём в избранное.</p>
      <Button
        variant="primary"
        size="lg"
        block
        icon={<SignInIcon size={20} aria-hidden />}
        to={`/login?to=${encodeURIComponent(back)}`}
      >
        Войти или присоединиться
      </Button>
      <Button variant="quiet" to={`/events/${eventId}`}>
        Открыть страницу события
      </Button>
    </div>
  );
}
