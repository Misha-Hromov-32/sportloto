import {
  CalendarBlankIcon,
  ChatsCircleIcon,
  MapPinIcon,
  PencilSimpleIcon,
  TicketIcon,
  UsersThreeIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import {
  AssistantMark,
  Button,
  CollectProgress,
  EventCard,
  FirstStepPassport,
  OrganizerBlock,
  PriceInfo,
  SportIcon,
} from '@/components';
import { dayjs, formatDuration, formatEventDate, formatTimeRange } from '@/lib/dates';
import { JOIN_MODE } from '@/lib/labels';
import type { EventCounts, OrganizerView } from '@/types/api';

import styles from './EventPreview.module.css';
import { formTimeZone, seriesCount, sportNameOf, startsAtOf, type EventForm } from './model';
import { previewSport, previewView, type PreviewRow } from './preview';

/** Карточка в ленте: та же, что в поиске, но без перехода по ссылке. */
export function FeedPreview({ form, organizer }: { form: EventForm; organizer: OrganizerView }) {
  const start = startsAtOf(form);
  if (!start || !form.address || (!form.sport && !form.newSportName)) {
    return (
      <article className={styles.draftPreview} aria-label="Предпросмотр вашей встречи">
        <h3>{form.title.trim() || 'Название встречи'}</h3>
        <ul className={styles.draftMeta}>
          <li>
            <TicketIcon size={17} aria-hidden />
            {sportNameOf(form) || 'Выберите направление'}
          </li>
          <li>
            <CalendarBlankIcon size={17} aria-hidden />
            {start ? formatEventDate(start, undefined, formTimeZone(form)) : 'Добавьте дату и время'}
          </li>
          <li>
            <MapPinIcon size={17} aria-hidden />
            {form.address || 'Укажите место встречи'}
          </li>
        </ul>
        <p className={styles.draftHint}>
          Карточка меняется по мере заполнения. Участники увидят встречу только после публикации.
        </p>
      </article>
    );
  }
  return (
    <div className={styles.feed} inert>
      <EventCard timeZone={formTimeZone(form)} event={previewView(form, organizer)} variant="poster" />
    </div>
  );
}

interface EventPreviewProps {
  form: EventForm;
  organizer: OrganizerView;
  counts?: EventCounts;
  /** Пометки помощника по строкам: «почему так». */
  marks?: Partial<Record<PreviewRow, string>>;
  /** Ошибки и пропуски по строкам. */
  problems?: Partial<Record<PreviewRow, string>>;
  onEdit?: (row: PreviewRow) => void;
  /** Строка, которую сейчас правят на месте, и её редактор. */
  editing?: PreviewRow | null;
  renderEditor?: (row: PreviewRow) => ReactNode;
}

/** Предпросмотр «так увидят участники». В режиме помощника каждую строку можно поправить на месте. */
export function EventPreview({
  form,
  organizer,
  counts,
  marks = {},
  problems = {},
  onEdit,
  editing,
  renderEditor,
}: EventPreviewProps) {
  const start = startsAtOf(form);
  const sport = previewSport(form);
  const series = seriesCount(form);
  const view = previewView(form, organizer, counts);

  const row = (key: PreviewRow, label: string, icon: ReactNode, value: ReactNode) => (
    <Row
      key={key}
      rowKey={key}
      label={label}
      icon={icon}
      mark={marks[key]}
      problem={problems[key]}
      onEdit={onEdit}
      editor={editing === key && renderEditor ? renderEditor(key) : null}
    >
      {value}
    </Row>
  );

  return (
    <article className={styles.root} aria-label="Предпросмотр события">
      <header className={styles.head}>
        {row(
          'sport',
          'Направление',
          <SportIcon sport={sport} size={22} />,
          <span className={styles.sport}>{sportNameOf(form) || 'Не выбрано'}</span>,
        )}
        {row(
          'title',
          'Название',
          null,
          <h2 className={styles.title}>{form.title.trim() || 'Без названия'}</h2>,
        )}
        <OrganizerBlock organizer={organizer} compact />
      </header>

      <div className={styles.facts}>
        {row(
          'when',
          'Когда',
          <CalendarBlankIcon size={22} aria-hidden />,
          start ? (
            <>
              <span className={styles.strong}>
                {formatEventDate(start, undefined, formTimeZone(form)).replace(/, \d{2}:\d{2}$/, '')},{' '}
                {formatTimeRange(start, form.durationMin, formTimeZone(form))}
              </span>
              <span className={styles.sub}>
                {formatDuration(form.durationMin)}
                {series > 1 &&
                  `. Каждую неделю до ${dayjs(form.repeatUntil).format('D MMMM')}, всего встреч: ${series}`}
              </span>
            </>
          ) : (
            <span className={styles.empty}>Дата и время не указаны</span>
          ),
        )}
        {row(
          'place',
          'Где',
          <MapPinIcon size={22} aria-hidden />,
          form.address.trim() ? (
            <>
              <span className={styles.strong}>{form.address}</span>
              {form.howToFind && <span className={styles.sub}>{form.howToFind}</span>}
            </>
          ) : (
            <span className={styles.empty}>Место не указано</span>
          ),
        )}
        {row(
          'joinMode',
          'Запись',
          <TicketIcon size={22} aria-hidden />,
          <>
            <span className={styles.strong}>{JOIN_MODE[form.joinMode].label}</span>
            <span className={styles.sub}>{JOIN_MODE[form.joinMode].hint}</span>
          </>,
        )}
        {row(
          'capacity',
          'Места',
          <UsersThreeIcon size={22} aria-hidden />,
          <CollectProgress
            counts={view.counts}
            capacity={form.capacity}
            minParticipants={form.minParticipants}
          />,
        )}
        {row(
          'price',
          'Стоимость',
          null,
          <PriceInfo
            price={view.price}
            confirmed={view.counts.confirmed}
            minParticipants={form.minParticipants}
            cancelPolicy={view.cancelPolicy}
            startsAt={start ?? undefined}
            paymentNote={form.paymentNote}
            online={view.paymentMode === 'online'}
          />,
        )}
      </div>

      {row(
        'firstStep',
        'Уровень и подготовка',
        null,
        <FirstStepPassport
          level={form.level}
          beginnersWelcome={form.beginnersWelcome}
          firstStep={view.firstStep}
          fields={sport.fields}
          extra={form.extra}
        />,
      )}

      {row(
        'description',
        'Описание',
        null,
        form.description.trim() ? (
          <p className={styles.description}>{form.description}</p>
        ) : (
          <span className={styles.empty}>Описания нет. Можно добавить пару слов о встрече</span>
        ),
      )}

      {row(
        'discussion',
        'Обсуждение',
        <ChatsCircleIcon size={22} aria-hidden />,
        <span>
          {form.discussion === 'everyone'
            ? 'Задать вопрос может любой, кто вошёл'
            : 'Писать в обсуждении могут только участники'}
        </span>,
      )}
    </article>
  );
}

function Row({
  rowKey,
  label,
  icon,
  mark,
  problem,
  onEdit,
  editor,
  children,
}: {
  rowKey: PreviewRow;
  label: string;
  icon: ReactNode;
  mark?: string;
  problem?: string;
  onEdit?: (row: PreviewRow) => void;
  editor: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      className={[styles.row, problem && styles.problem, editor && styles.editing].filter(Boolean).join(' ')}
      aria-label={label}
    >
      <div className={styles.rowHead}>
        <span className={styles.rowLabel}>
          {icon}
          {label}
        </span>
        {mark !== undefined && <AssistantMark why={mark} />}
        {onEdit && !editor && (
          <Button
            variant="quiet"
            size="sm"
            icon={<PencilSimpleIcon size={18} aria-hidden />}
            className={styles.edit}
            onClick={() => onEdit(rowKey)}
            aria-label={`Изменить: ${label.toLowerCase()}`}
          >
            Изменить
          </Button>
        )}
      </div>
      {editor ? (
        <div className={styles.editor}>{editor}</div>
      ) : (
        <div className={styles.rowValue}>{children}</div>
      )}
      {problem && !editor && (
        <p className={styles.problemText} role="alert">
          <WarningCircleIcon size={18} weight="bold" aria-hidden />
          {problem}
        </p>
      )}
    </section>
  );
}
