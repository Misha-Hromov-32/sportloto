import { CloudSlashIcon, MapPinIcon, PhoneIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { useMe } from '@/lib/api';
import { dayjs, dayLabel, formatTimeRange } from '@/lib/dates';
import type { OfflineCard } from '@/types/engagement';

import styles from './offline.module.css';
import { useOfflineCards, type SavedCards } from './useOfflineCards';

function updatedLabel(iso: string): string {
  const d = dayjs(iso);
  return d.isSame(dayjs(), 'day') ? `обновлено в ${d.format('HH:mm')}` : `обновлено ${d.format('D MMMM в HH:mm')}`;
}

/** Плашка «Нет связи — показываем сохранённое». Статус словами и иконкой, не только цветом. */
export function OfflineNotice({ saved, failed }: { saved: SavedCards | null; failed?: boolean }) {
  return (
    <p className={styles.notice} role="status">
      <CloudSlashIcon size={22} weight="bold" aria-hidden />
      <span>
        {failed ? 'Не удалось обновить' : 'Нет связи'}
        {saved
          ? `. Показаны сохранённые записи, ${updatedLabel(saved.savedAt)}.`
          : '. Сохранённых записей на этом устройстве пока нет.'}
      </span>
    </p>
  );
}

export function OfflineCardView({ card }: { card: OfflineCard }) {
  const tel = card.organizerContact.match(/\+?\d[\d\s()-]{6,}\d/)?.[0];
  return (
    <article className={styles.card}>
      <p className={styles.when}>
        {dayLabel(card.startsAt)}, {dayjs(card.startsAt).format('D MMMM')},{' '}
        <span className="tabular">{formatTimeRange(card.startsAt, card.durationMin)}</span>
      </p>
      <h3 className={styles.title}>{card.title}</h3>
      <dl className={styles.list}>
        <div>
          <dt>
            <MapPinIcon size={18} aria-hidden /> Где
          </dt>
          <dd>{card.address}</dd>
        </div>
        {card.howToFind && (
          <div>
            <dt>Как найти</dt>
            <dd>{card.howToFind}</dd>
          </div>
        )}
        {card.bring && (
          <div>
            <dt>Что взять</dt>
            <dd>{card.bring}</dd>
          </div>
        )}
        <div>
          <dt>
            <PhoneIcon size={18} aria-hidden /> Организатор
          </dt>
          <dd>
            {card.organizerName}
            {card.organizerContact && (
              <>
                {', '}
                {tel ? <a href={`tel:${tel.replace(/[^\d+]/g, '')}`}>{card.organizerContact}</a> : card.organizerContact}
              </>
            )}
          </dd>
        </div>
        {card.privateInfo && (
          <div>
            <dt>Только для участников</dt>
            <dd>{card.privateInfo}</dd>
          </div>
        )}
      </dl>
    </article>
  );
}

/**
 * Н5 в «Моих занятиях»: пока есть связь, обновляет сохранённые карточки и показывает обычный экран.
 * Без связи — сохранённые ближайшие записи. Если загрузка не удалась — сохранённое над сообщением об ошибке.
 */
export function OfflineGate({
  userId,
  failed,
  children,
}: {
  userId: string | undefined;
  failed: boolean;
  children: ReactNode;
}) {
  const { online, saved } = useOfflineCards(userId);
  if (online && !failed) return <>{children}</>;
  return (
    <>
      <section className={styles.panel} aria-labelledby="offline-title">
        <OfflineNotice saved={saved} failed={online && failed} />
        <h2 id="offline-title" className={styles.panelTitle}>
          Ближайшие занятия
        </h2>
        {saved?.cards.length ? (
          <div className={styles.cards}>
            {saved.cards.map((c) => (
              <OfflineCardView key={c.eventId} card={c} />
            ))}
          </div>
        ) : (
          <p className={styles.empty}>
            {saved
              ? 'На момент сохранения у вас не было подтверждённых записей.'
              : 'Карточки сохраняются, когда вы открываете «Мои занятия» со связью.'}
          </p>
        )}
        {!online && <p className={styles.hint}>Остальное появится, когда связь вернётся. Обновлять страницу не нужно.</p>}
      </section>
      {online && children}
    </>
  );
}

/** Н5 на карточке события: держит сохранённое свежим, без связи показывает сохранённую карточку этой встречи. */
export function EventOffline({ eventId }: { eventId: string }) {
  const { me } = useMe();
  const { online, saved } = useOfflineCards(me?.id);
  if (online) return null;
  const card = saved?.cards.find((c) => c.eventId === eventId);
  return (
    <section className={styles.panel} aria-label="Сохранённая карточка">
      <OfflineNotice saved={saved} />
      {card ? (
        <OfflineCardView card={card} />
      ) : (
        <p className={styles.empty}>Эта встреча не сохранена на устройстве.</p>
      )}
    </section>
  );
}
