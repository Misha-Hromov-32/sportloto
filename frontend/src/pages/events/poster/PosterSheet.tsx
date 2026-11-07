import { SealCheckIcon, SunIcon } from '@phosphor-icons/react';
import { QRCodeSVG } from 'qrcode.react';

import { SportIcon } from '@/components';
import { dayjs, dayLabel, formatTimeRange } from '@/lib/dates';
import { EVENT_LEVEL, JOIN_MODE } from '@/lib/labels';
import { priceSummary } from '@/lib/money';
import { count, WORDS } from '@/lib/plural';
import { capitalize } from '@/lib/text';
import type { EventDetails } from '@/types/api';

import styles from './Poster.module.css';

const TABS = 7;

function titleSize(title: string): string {
  if (title.length <= 26) return styles.titleXl!;
  if (title.length <= 48) return styles.titleL!;
  return styles.titleM!;
}

/** Лист А4: всё в долях ширины листа, поэтому экранный предпросмотр и печать совпадают. */
export function PosterSheet({
  event: e,
  url,
  shortUrl,
}: {
  event: EventDetails;
  url: string;
  shortUrl: string;
}) {
  const start = dayjs(e.startsAt);
  const day = `${capitalize(dayLabel(e.startsAt))}, ${start.format('D MMMM')}`;
  const price = priceSummary(e.price, e.counts.confirmed, e.minParticipants);
  const tab = `${e.sport.name}, ${capitalize(start.format('dd'))} ${start.format('D.MM, HH:mm')}`;

  return (
    <article className={styles.sheet} data-theme="light" aria-label={`Афиша: ${e.title}`}>
      <header className={styles.band}>
        <span className={styles.bandSport}>
          <SportIcon sport={e.sport} size={64} weight="fill" />
          <span>{e.sport.name}</span>
        </span>
        <span className={styles.bandBrand}>Спорт и точка</span>
      </header>

      <div className={styles.body}>
        <div className={styles.titleRow}>
          <h1 className={[styles.title, titleSize(e.title)].join(' ')}>{e.title}</h1>
          {e.beginnersWelcome && (
            <span className={styles.stamp}>
              <SunIcon weight="fill" aria-hidden />
              Рады новичкам
            </span>
          )}
        </div>

        <div className={styles.when}>
          <span className={styles.label}>Когда</span>
          <span className={styles.day}>{day}</span>
          <span className={styles.time}>{formatTimeRange(e.startsAt, e.durationMin)}</span>
        </div>

        <div className={styles.where}>
          <span className={styles.label}>Где</span>
          <span className={styles.address}>{e.place.address}</span>
          {(e.place.landmark || e.firstStep.howToFind) && (
            <span className={styles.note}>{e.place.landmark || e.firstStep.howToFind}</span>
          )}
        </div>

        <div className={styles.bottom}>
          <dl className={styles.facts}>
            <div>
              <dt>Кому</dt>
              <dd>{EVENT_LEVEL[e.level]}</dd>
            </div>
            <div>
              <dt>Что взять</dt>
              <dd>{e.firstStep.bring || 'Удобную одежду'}</dd>
            </div>
            <div>
              <dt>Стоимость</dt>
              <dd>{price.main}</dd>
            </div>
            <div>
              <dt>Запись</dt>
              <dd>
                {JOIN_MODE[e.joinMode].label}
                {e.capacity ? `, ${count(e.capacity, WORDS.place)}` : ''}
              </dd>
            </div>
            <div className={styles.factWide}>
              <dt>Организатор</dt>
              <dd>
                {e.organizerView.name}
                {e.organizerView.verified && (
                  <span className={styles.verified}>
                    <SealCheckIcon weight="fill" aria-hidden />
                    организация проверена
                  </span>
                )}
              </dd>
            </div>
          </dl>

          <div className={styles.qr}>
            <QRCodeSVG
              value={url}
              size={256}
              level="M"
              marginSize={0}
              bgColor="transparent"
              fgColor="currentColor"
              className={styles.qrCode}
              title="QR-код на страницу события"
            />
            <span className={styles.qrText}>Наведите камеру телефона, чтобы записаться</span>
            <span className={styles.qrLink}>{shortUrl}</span>
          </div>
        </div>
      </div>

      <ul className={styles.tabs} aria-label="Отрывные корешки со ссылкой">
        {Array.from({ length: TABS }, (_, i) => (
          <li key={i} className={styles.tab}>
            <span className={styles.tabInner}>
              <span>{tab}</span>
              <span className={styles.tabLink}>{shortUrl}</span>
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
