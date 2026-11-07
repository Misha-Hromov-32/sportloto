import { CheckCircleIcon, LinkSimpleIcon, PrinterIcon } from '@phosphor-icons/react';
import { App, Input } from 'antd';
import { useState } from 'react';

import { Button, EventCard } from '@/components';
import { dayjs, formatEventDate } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import type { EventDetails } from '@/types/api';

import styles from './create.module.css';

/** Экран после публикации: встреча уже в поиске, дальше — открыть, поделиться, распечатать. */
export function SuccessScreen({
  event,
  meetings,
  gathered,
  onAnother,
}: {
  event: EventDetails;
  meetings: number;
  gathered: number;
  onAnother: () => void;
}) {
  const { message } = App.useApp();
  const [manualLink, setManualLink] = useState(false);
  const url = `${window.location.origin}/events/${event.id}`;

  const share = async () => {
    try {
      await navigator.clipboard.writeText(url);
      message.success('Ссылка скопирована. Отправьте её тем, кого зовёте');
    } catch {
      setManualLink(true);
    }
  };

  return (
    <section className={styles.success} aria-labelledby="success-title">
      <div className={styles.successHead}>
        <CheckCircleIcon size={40} weight="fill" aria-hidden className={styles.successIcon} />
        <div>
          <h1 id="success-title" className="h1">
            Встреча опубликована
          </h1>
          <p className={styles.successText}>
            «{event.title}», {formatEventDate(event.startsAt)}. Её уже видят все, кто ищет занятие.
          </p>
          {meetings > 1 && event.series && (
            <p className={styles.successText}>
              Создали {count(meetings, WORDS.meeting)}: каждую неделю до {dayjs(event.series.until).format('D MMMM')}.
            </p>
          )}
          {gathered > 0 && (
            <p className={styles.successText}>
              {count(gathered, WORDS.person)} из объявления уже в списке участников, им пришло уведомление.
            </p>
          )}
        </div>
      </div>

      <div className={styles.successCard} inert>
        <EventCard event={event} />
      </div>

      <div className={styles.successActions}>
        <Button variant="primary" size="lg" to={`/events/${event.id}`}>
          Открыть событие
        </Button>
        <Button variant="secondary" icon={<LinkSimpleIcon size={20} aria-hidden />} onClick={share}>
          Поделиться ссылкой
        </Button>
        <Button variant="secondary" icon={<PrinterIcon size={20} aria-hidden />} to={`/events/${event.id}/poster`}>
          Распечатать афишу
        </Button>
      </div>
      {manualLink && (
        <div className={styles.manualLink}>
          <label htmlFor="event-link">Скопируйте ссылку вручную</label>
          <Input id="event-link" size="large" value={url} readOnly onFocus={(e) => e.target.select()} />
        </div>
      )}
      <div className={styles.successMore}>
        <Button variant="quiet" onClick={onAnother}>
          Создать ещё одну встречу
        </Button>
        <Button variant="quiet" to="/me">
          Мои занятия
        </Button>
      </div>
    </section>
  );
}
