import { ArrowSquareOutIcon, CalendarBlankIcon, MapPinIcon, PhoneIcon, SignpostIcon } from '@phosphor-icons/react';
import { useParams } from 'react-router';

import { Button, ErrorState, GoneState, PageSkeleton } from '@/components';
import { ENGAGEMENT_API, useLiveGet } from '@/lib/api';
import { dayjs, dayLabel, formatTimeRange } from '@/lib/dates';
import type { SharedCard } from '@/types/engagement';

import styles from './share.module.css';

/** Страница для близкого по ссылке участника. Открывается без входа, только чтение. */
export default function SharePage() {
  const { token = '' } = useParams();
  const { data, isLoading, isError, error, refetch } = useLiveGet<SharedCard>(ENGAGEMENT_API.shared(token), [
    'events',
    'participations',
  ]);

  if (isLoading)
    return (
      <div className="container">
        <PageSkeleton label="Открываем встречу…" />
      </div>
    );

  if (isError || !data) {
    if (error?.code === 'not_found')
      return (
        <div className="container">
          <GoneState
            title="Ссылка не работает"
            actions={
              <Button variant="secondary" to="/events">
                Посмотреть занятия
              </Button>
            }
          >
            Возможно, в ней опечатка. Попросите прислать ссылку ещё раз.
          </GoneState>
        </div>
      );
    return (
      <div className="container">
        <ErrorState layout="page" title="Не удалось открыть встречу" onRetry={() => void refetch()}>
          Проверьте интернет и нажмите «Повторить».
        </ErrorState>
      </div>
    );
  }

  const who = data.participantName;
  if (data.status !== 'active') {
    const gone = {
      revoked: ['Ссылку отозвали', 'Доступ к этой встрече закрыт. Подробности можно узнать у того, кто прислал ссылку.'],
      expired: ['Встреча уже прошла', 'Ссылка работала до конца встречи и теперь не показывает подробности.'],
      cancelled: [
        'Встреча отменена',
        `«${data.title}» не состоится${data.cancelReason ? `. Причина: ${data.cancelReason}` : ''}.`,
      ],
      left: ['Запись отменена', `${who} больше не идёт на «${data.title}», поэтому адрес и время скрыты.`],
    }[data.status];
    return (
      <div className="container">
        <GoneState title={gone[0]!}>{gone[1]}</GoneState>
      </div>
    );
  }

  const start = dayjs(data.startsAt);
  const tel = data.organizerContact.match(/\+?\d[\d\s()-]{6,}\d/)?.[0];
  const map = `https://www.openstreetmap.org/search?query=${encodeURIComponent(data.address)}`;

  return (
    <div className={['container', styles.page].join(' ')}>
      <p className={styles.eyebrow}>Подробности встречи, на которую идёт {who}</p>
      <h1 className={styles.title}>{data.title}</h1>
      {data.sportName && <p className={styles.sport}>{data.sportName}</p>}

      <dl className={styles.facts}>
        <div>
          <dt>
            <CalendarBlankIcon size={20} aria-hidden />
            Когда
          </dt>
          <dd>
            <b>
              {dayLabel(data.startsAt)}, {start.format('D MMMM')}
            </b>
            <span className="tabular">{formatTimeRange(data.startsAt, data.durationMin)}</span>
          </dd>
        </div>
        <div>
          <dt>
            <MapPinIcon size={20} aria-hidden />
            Где
          </dt>
          <dd>
            <b>{data.address}</b>
            <a href={map} target="_blank" rel="noreferrer" className={styles.mapLink}>
              Открыть на карте
              <ArrowSquareOutIcon size={16} aria-hidden />
              <span className="sr-only">(в новой вкладке)</span>
            </a>
          </dd>
        </div>
        {data.howToFind && (
          <div>
            <dt>
              <SignpostIcon size={20} aria-hidden />
              Как найти на месте
            </dt>
            <dd>{data.howToFind}</dd>
          </div>
        )}
        <div>
          <dt>
            <PhoneIcon size={20} aria-hidden />
            Организатор
          </dt>
          <dd>
            <b>{data.organizerName}</b>
            {data.organizerContact &&
              (tel ? (
                <a href={`tel:${tel.replace(/[^\d+]/g, '')}`}>{data.organizerContact}</a>
              ) : (
                <span>{data.organizerContact}</span>
              ))}
          </dd>
        </div>
        {data.privateInfo && (
          <div>
            <dt>Для участников</dt>
            <dd>{data.privateInfo}</dd>
          </div>
        )}
      </dl>

      <p className={styles.note}>
        Ссылка работает до {dayjs(data.expiresAt).format('D MMMM, HH:mm')}. Если {who} отменит запись или отзовёт
        ссылку, подробности скроются.
      </p>
    </div>
  );
}
