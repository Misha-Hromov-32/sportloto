import { ArrowLeftIcon, PrinterIcon } from '@phosphor-icons/react';
import { useOne, type HttpError } from '@refinedev/core';
import { useParams } from 'react-router';

import { Button, ErrorState, GoneState } from '@/components';
import type { EventDetails } from '@/types/api';

import styles from './poster/Poster.module.css';
import { PosterSheet } from './poster/PosterSheet';

const GONE: Partial<Record<EventDetails['state'], { title: string; text: string }>> = {
  removed: {
    title: 'Событие снято с публикации',
    text: 'Модератор снял событие, поэтому афишу распечатать нельзя. Причина указана на странице события.',
  },
  cancelled: {
    title: 'Событие отменено',
    text: 'Организатор отменил встречу. Если афиша уже висит, её лучше снять.',
  },
  past: {
    title: 'Событие уже прошло',
    text: 'Афиша нужна только для будущих встреч. Найдите следующее занятие в ленте.',
  },
  deleted: {
    title: 'Событие удалено',
    text: 'Этой встречи больше нет на платформе.',
  },
};

export default function EventPosterPage() {
  const { id = '' } = useParams();
  const { result: event, query } = useOne<EventDetails, HttpError>({ resource: 'events', id });
  const url = `${window.location.origin}/events/${id}`;
  const shortUrl = `${window.location.host}/events/${id}`;
  const back = (
    <Button variant="secondary" to={`/events/${id}`} icon={<ArrowLeftIcon size={20} aria-hidden />}>
      Вернуться к событию
    </Button>
  );

  if (query.isError) {
    const status = query.error?.statusCode;
    return (
      <div className={styles.stage}>
        <div className={styles.gone}>
          {status === 404 || status === 410 ? (
            <GoneState
              title={status === 410 ? 'Событие удалено' : 'Такого события нет'}
              actions={
                <Button variant="primary" to="/events">
                  Найти встречу
                </Button>
              }
            >
              Возможно, ссылка устарела. Афишу можно сделать для любого события в ленте.
            </GoneState>
          ) : (
            <ErrorState title="Не удалось загрузить событие" onRetry={() => void query.refetch()}>
              Проверьте интернет и нажмите «Повторить».
            </ErrorState>
          )}
        </div>
      </div>
    );
  }

  const gone = event ? GONE[event.state] : undefined;
  if (event && gone) {
    return (
      <div className={styles.stage}>
        <div className={styles.gone}>
          <GoneState
            title={gone.title}
            actions={
              <>
                {back}
                <Button variant="primary" to="/events">
                  Найти встречу
                </Button>
              </>
            }
          >
            {gone.text}
          </GoneState>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stage}>
      <div className={styles.toolbar}>
        <div className={styles.toolbarText}>
          <h1 className={styles.toolbarTitle}>Афиша для печати</h1>
          <p className={styles.toolbarHint}>
            Лист А4, книжная ориентация. Читается и в чёрно-белой печати. QR-код ведёт на страницу события.
          </p>
        </div>
        <div className={styles.toolbarActions}>
          {back}
          <Button
            variant="primary"
            icon={<PrinterIcon size={20} aria-hidden />}
            disabled={!event}
            onClick={() => window.print()}
          >
            Распечатать
          </Button>
        </div>
      </div>

      {event ? (
        <PosterSheet event={event} url={url} shortUrl={shortUrl} />
      ) : (
        <div
          className={[styles.sheet, styles.sheetSkeleton].join(' ')}
          role="status"
          aria-label="Готовим афишу…"
        />
      )}
    </div>
  );
}
