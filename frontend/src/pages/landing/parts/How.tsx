import {
  CaretRightIcon,
  CalendarBlankIcon,
  ChatCircleTextIcon,
  CheckCircleIcon,
  ClockIcon,
  HourglassIcon,
  MapPinIcon,
} from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { useRef, useState } from 'react';
import { Link } from 'react-router';

import { Button, ErrorState, SkeletonBlock, SportIcon } from '@/components';
import { formatDuration, formatEventDate, formatShortDate, formatTime } from '@/lib/dates';
import { imageAttrs } from '@/lib/images';
import { EVENT_LEVEL } from '@/lib/labels';
import { priceSummary } from '@/lib/money';
import { count, WORDS } from '@/lib/plural';
import type { EventView, MessageView } from '@/types/api';

import { HOW_STEPS } from './content';
import { cx } from './cx';
import styles from './How.module.css';
import landing from './Landing.module.css';
import type { LandingData } from './useLandingData';

const SHORT_LABELS = ['Найти', 'Условия', 'Запись', 'Вопросы'];
const ACTION_LABELS = ['Найти встречу', 'Открыть карточку', 'Перейти к записи', 'Открыть обсуждение'];

export function How({ data, createTo }: { data: LandingData; createTo: string }) {
  const [active, setActive] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const event = data.upcoming[0];
  const messages = useList<MessageView>({
    resource: 'messages',
    filters: [{ field: 'eventId', operator: 'eq', value: event?.id ?? '' }],
    sorters: [{ field: 'createdAt', order: 'asc' }],
    pagination: { mode: 'off' },
    queryOptions: { enabled: active === 3 && !!event },
  });
  const step = HOW_STEPS[active]!;
  const to = !event
    ? createTo
    : active === 0
      ? '/events'
      : '/events/' + event.id + (active === 3 ? '#discussion' : '');
  const action = !event ? 'Создать встречу' : ACTION_LABELS[active];

  return (
    <section className={cx('section', 'how')} id="how" aria-labelledby="how-title">
      <div className={landing.container}>
        <h2 id="how-title" className={landing.h2} data-reveal="title">
          Как это работает
        </h2>
        <p className={landing.lead} data-reveal="">
          Найдите встречу, прочитайте условия и запишитесь. Выберите шаг ниже, чтобы посмотреть пример.
        </p>
        <div className={styles.grid}>
          <div
            className={styles.steps}
            data-stagger=""
            role="group"
            aria-label="Шаги знакомства с платформой"
          >
            {HOW_STEPS.map((item, index) => (
              <button
                key={item.title}
                ref={(element) => {
                  buttons.current[index] = element;
                }}
                type="button"
                className={styles.step}
                aria-pressed={active === index}
                aria-controls="how-preview"
                onClick={() => setActive(index)}
                onKeyDown={(event) => {
                  let target = index;
                  if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
                    target = (index + 1) % HOW_STEPS.length;
                  else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
                    target = (index + HOW_STEPS.length - 1) % HOW_STEPS.length;
                  else if (event.key === 'Home') target = 0;
                  else if (event.key === 'End') target = HOW_STEPS.length - 1;
                  else return;
                  event.preventDefault();
                  setActive(target);
                  buttons.current[target]?.focus();
                }}
              >
                <span className={styles.number} aria-hidden>
                  {index + 1}
                </span>
                <span className={styles.stepCopy}>
                  <span className={styles.stepTitle}>{item.title}</span>
                  <span className={styles.shortTitle} aria-hidden>
                    {SHORT_LABELS[index]}
                  </span>
                  <span className={styles.stepText}>{item.text}</span>
                </span>
              </button>
            ))}
          </div>
          <div
            data-motion-key={active}
            id="how-preview"
            className={styles.preview}
            role="region"
            aria-label={step.title}
          >
            <div className={styles.mobileCopy}>
              <h3>{step.title}</h3>
              <p>{step.text}</p>
            </div>
            <p className={styles.previewBar}>
              Шаг {active + 1} из {HOW_STEPS.length}
            </p>
            <div className={styles.window}>
              <div className={styles.content} data-preview-step={active}>
                {data.eventsLoading ? (
                  <div className={styles.loading} aria-label="Загрузка примера">
                    <SkeletonBlock height={32} width="65%" />
                    <SkeletonBlock height={100} />
                    <SkeletonBlock height={100} />
                  </div>
                ) : data.eventsError ? (
                  <ErrorState onRetry={data.refetchEvents}>
                    Не удалось загрузить пример события. Попробуйте ещё раз.
                  </ErrorState>
                ) : !event ? (
                  <Empty city={data.city.in} />
                ) : active === 0 ? (
                  <Feed events={data.upcoming.slice(0, 3)} city={data.city.name} />
                ) : active === 1 ? (
                  <EventConditions event={event} />
                ) : active === 2 ? (
                  <JoinModes />
                ) : (
                  <Discussion
                    event={event}
                    messages={messages.result.data ?? []}
                    loading={messages.query.isLoading}
                    error={messages.query.isError}
                  />
                )}
              </div>
              <div className={styles.action}>
                <Button to={to} variant="primary" block>
                  {action}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Empty({ city }: { city: string }) {
  return (
    <div className={styles.empty}>
      <CalendarBlankIcon size={40} aria-hidden />
      <h3>В {city} пока нет событий</h3>
      <p>Создайте первую встречу. Условия, запись и обсуждение появятся в её карточке.</p>
    </div>
  );
}

function Feed({ events, city }: { events: EventView[]; city: string }) {
  return (
    <>
      <p className={styles.eyebrow}>{city}</p>
      <h3 className={styles.previewTitle}>События рядом</h3>
      <p className={styles.hint}>Выберите встречу и посмотрите условия.</p>
      <div className={styles.feed}>
        {events.map((event) => (
          <Link key={event.id} to={'/events/' + event.id} className={styles.eventRow}>
            <span className={styles.sport}>
              <SportIcon sport={event.sport} size={24} aria-hidden />
            </span>
            <span className={styles.eventCopy}>
              <b>{event.title}</b>
              <small>
                {formatShortDate(event.startsAt)} · {formatTime(event.startsAt)}
              </small>
              <small>{event.joinMode === 'open' ? 'Свободная запись' : 'По заявке'}</small>
            </span>
            <CaretRightIcon size={18} aria-hidden />
          </Link>
        ))}
      </div>
    </>
  );
}

function EventConditions({ event }: { event: EventView }) {
  return (
    <>
      {event.coverUrl && (
        <img
          className={styles.cover}
          {...imageAttrs(event.coverUrl, { width: 320, height: 144, crop: false })}
          alt=""
          loading="lazy"
          decoding="async"
        />
      )}
      <p className={styles.eyebrow}>{event.sport.name}</p>
      <h3 className={styles.previewTitle}>{event.title}</h3>
      <dl className={styles.details}>
        <div>
          <dt>
            <CalendarBlankIcon size={18} aria-hidden /> Когда
          </dt>
          <dd>{formatEventDate(event.startsAt)}</dd>
        </div>
        <div>
          <dt>
            <MapPinIcon size={18} aria-hidden /> Где
          </dt>
          <dd>{event.place.address}</dd>
        </div>
        <div>
          <dt>
            <ClockIcon size={18} aria-hidden /> Длительность
          </dt>
          <dd>{formatDuration(event.durationMin)}</dd>
        </div>
        <div>
          <dt>Подготовка</dt>
          <dd>{EVENT_LEVEL[event.level]}</dd>
        </div>
        <div>
          <dt>Стоимость</dt>
          <dd>{priceSummary(event.price, event.counts.confirmed, event.minParticipants).main}</dd>
        </div>
        <div>
          <dt>Свободные места</dt>
          <dd>
            {event.counts.spotsLeft === null ? 'Без ограничения' : count(event.counts.spotsLeft, WORDS.place)}
          </dd>
        </div>
      </dl>
    </>
  );
}

function JoinModes() {
  return (
    <>
      <p className={styles.eyebrow}>Два способа записи</p>
      <h3 className={styles.previewTitle}>Статус виден сразу</h3>
      <div className={styles.status}>
        <CheckCircleIcon size={26} weight="fill" aria-hidden />
        <div>
          <small>После свободной записи</small>
          <b>Вы участник</b>
          <p>Место сразу за вами. Встреча появится в «Моих занятиях».</p>
        </div>
      </div>
      <div className={styles.status}>
        <HourglassIcon size={26} aria-hidden />
        <div>
          <small>После отправки заявки</small>
          <b>Заявка на рассмотрении</b>
          <p>Организатор посмотрит заявку, и вам придёт уведомление о его решении.</p>
        </div>
      </div>
      <p className={styles.hint}>Способ записи указан в карточке до того, как вы присоединитесь.</p>
    </>
  );
}

function Discussion({
  event,
  messages,
  loading,
  error,
}: {
  event: EventView;
  messages: MessageView[];
  loading: boolean;
  error: boolean;
}) {
  const visible = messages.filter((message) => message.text);
  const answer = visible.find((message) => message.author?.isOrganizer && message.replyTo);
  const question = visible.find((message) => message.id === answer?.replyTo);
  const thread = answer && question ? [question, answer] : visible.slice(0, 3);
  return (
    <>
      <p className={styles.eyebrow}>{event.title}</p>
      <h3 className={styles.previewTitle}>Обсуждение встречи</h3>
      {loading ? (
        <SkeletonBlock height={160} />
      ) : error ? (
        <p className={styles.hint}>Обсуждение не загрузилось. Откройте его на странице события.</p>
      ) : thread.length ? (
        <>
          <p className={styles.hint}>Сообщения из обсуждения этого события.</p>
          <div className={styles.messages}>
            {thread.map((message) => (
              <div
                key={message.id}
                className={styles.message}
                data-organizer={message.author?.isOrganizer || undefined}
              >
                <b>
                  {message.author?.orgName ?? message.author?.name ?? 'Участник'}
                  {message.author?.isOrganizer && <small>Организатор</small>}
                </b>
                <p>{message.text}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <ChatCircleTextIcon size={36} aria-hidden />
          <h4>Пока нет сообщений</h4>
          <p>Спросите, что взять с собой или как найти площадку. Ответ увидят и другие участники.</p>
        </div>
      )}
    </>
  );
}
