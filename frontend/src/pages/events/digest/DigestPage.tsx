import { BellSlashIcon, GearSixIcon, SparkleIcon } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';

import { Button, EmptyState, ErrorState, GoneState, NoAccessState, PageSkeleton } from '@/components';
import { DIGEST_API, errorMessage, useAction, useLiveGet, useMe } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { useSettings } from '@/theme/useSettings';
import type { DigestView } from '@/types/api';

import { FeedCard } from '../feed/FeedCard';
import feed from '../feed/Feed.module.css';
import styles from './DigestPage.module.css';

/** Ссылка «Отписаться» из письма: выключает подборку без входа на сайт. */
function Unsubscribe() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const { run } = useAction<{ ok: true; wasOn: boolean }>();
  const [state, setState] = useState<'wait' | 'done' | 'error'>('wait');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run(DIGEST_API.unsubscribe, { token }, { silent: true })
      .then(() => setState('done'))
      .catch((e: unknown) => {
        setError(errorMessage(e));
        setState('error');
      });
  }, [run, token]);

  if (state === 'wait')
    return (
      <div className="container">
        <PageSkeleton label="Выключаем подборку…" />
      </div>
    );
  if (state === 'error')
    return (
      <div className="container">
        <GoneState
          title="Не получилось отписаться"
          actions={
            <Button variant="secondary" to="/settings#settings-digest">
              Открыть настройки
            </Button>
          }
        >
          {error}
        </GoneState>
      </div>
    );
  return (
    <div className="container">
      <EmptyState
        layout="page"
        icon={<BellSlashIcon size={28} aria-hidden />}
        title="Подборка выключена"
        actions={
          <>
            <Button variant="primary" to="/events">
              Посмотреть занятия
            </Button>
            <Button variant="quiet" to="/settings#settings-digest">
              Включить снова
            </Button>
          </>
        }
      >
        Письма и уведомления с подборкой встреч больше не придут. Включить её снова можно в настройках.
      </EmptyState>
    </div>
  );
}

function Digest({ id }: { id: string }) {
  const { isGuest, isLoading: meLoading } = useMe();
  const { settings } = useSettings();
  const { data, isLoading, isError, error, refetch } = useLiveGet<DigestView>(
    DIGEST_API.digest(id),
    ['events', 'participations'],
    !isGuest,
  );

  if (meLoading || isLoading)
    return (
      <div className="container">
        <PageSkeleton label="Открываем подборку…" />
      </div>
    );
  if (isGuest)
    return (
      <div className="container">
        <NoAccessState guest loginTo={`/digest/${id}`} title="Войдите, чтобы открыть подборку">
          Подборку видит только тот, кому мы её прислали.
        </NoAccessState>
      </div>
    );
  if (isError || !data) {
    if (error?.code === 'not_found')
      return (
        <div className="container">
          <GoneState
            title="Подборка не найдена"
            actions={
              <Button variant="secondary" to="/events">
                Посмотреть занятия
              </Button>
            }
          >
            Возможно, ссылка устарела или подборку прислали другому человеку.
          </GoneState>
        </div>
      );
    return (
      <div className="container">
        <ErrorState layout="page" title="Не удалось открыть подборку" onRetry={() => void refetch()}>
          Проверьте интернет и нажмите «Повторить».
        </ErrorState>
      </div>
    );
  }

  const n = data.items.length;
  return (
    <div className={['container', styles.page].join(' ')}>
      <header className={styles.head}>
        <p className={styles.eyebrow}>
          <SparkleIcon size={18} weight="fill" aria-hidden />
          Подборка дня
        </p>
        <h1 className="h1">{n ? `${count(n, WORDS.meeting)} для вас` : 'Встречи из подборки'}</h1>
        <p className={styles.lead}>
          Собрали {formatAgo(data.createdAt)} по вашим интересам и району. Под каждой встречей написано, чем
          она вам подходит. Нажмите на встречу, чтобы узнать подробности и записаться.
        </p>
      </header>

      {n ? (
        <ul className={[feed.grid, settings.simple && feed.gridLarge].filter(Boolean).join(' ')}>
          {data.items.map(({ event, reasons }) => (
            <li key={event.id} className={feed.cell}>
              <FeedCard event={{ ...event, matchReasons: reasons }} showMatch large={settings.simple} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="Встречи из подборки больше недоступны">
          Организаторы удалили их. Свежие встречи рядом есть в ленте.
        </EmptyState>
      )}

      <div className={styles.foot}>
        <Button variant="primary" to="/events">
          Все занятия рядом
        </Button>
        <Button variant="quiet" icon={<GearSixIcon size={18} aria-hidden />} to="/settings#settings-digest">
          Настроить подборку
        </Button>
      </div>
    </div>
  );
}

/** Подборка дня: три встречи из уведомления или письма. Здесь же — отписка по ссылке из письма. */
export default function DigestPage() {
  const { id = '' } = useParams();
  return id === 'unsubscribe' ? <Unsubscribe /> : <Digest id={id} />;
}
