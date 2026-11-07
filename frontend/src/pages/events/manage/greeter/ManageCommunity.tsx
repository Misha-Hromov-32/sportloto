import {
  CheckCircleIcon,
  HandWavingIcon,
  InfoIcon,
  LightningIcon,
  MedalMilitaryIcon,
  MinusIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import { Input, Select } from 'antd';
import { useId, useState, type ReactNode } from 'react';

import { Avatar, Button, ErrorState, SkeletonBlock } from '@/components';
import { API, errorMessage, useAction, useLiveGet } from '@/lib/api';
import { formatTime } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import type { EventDetails, GreeterView, UrgentView } from '@/types/api';

import styles from './greeter.module.css';

/** С1, С3, Н2 в управлении событием: кто встретит новичков, срочный добор, программа. */
export function ManageCommunity({ event }: { event: EventDetails }) {
  return (
    <section className={styles.community} aria-label="Новички и добор игроков">
      <GreeterPanel event={event} />
      <UrgentPanel event={event} />
      {event.organizer.kind === 'org' && <ProgramPanel event={event} />}
    </section>
  );
}

function Panel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <h2 id={id} className={styles.panelTitle}>
        {icon}
        {title}
      </h2>
      {children}
    </section>
  );
}

function Status({ tone, children }: { tone: 'ok' | 'wait' | 'off'; children: ReactNode }) {
  const Icon = tone === 'ok' ? CheckCircleIcon : tone === 'wait' ? LightningIcon : InfoIcon;
  return (
    <p className={[styles.status, styles[`status-${tone}`]].join(' ')}>
      <Icon size={20} weight={tone === 'off' ? 'regular' : 'fill'} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

function PanelSkeleton() {
  return (
    <div className={styles.skeleton} aria-hidden>
      <SkeletonBlock width="70%" height={16} />
      <SkeletonBlock width="100%" height={44} />
    </div>
  );
}

// ---------- С1: встречающий ----------

function GreeterPanel({ event }: { event: EventDetails }) {
  const { data, isLoading, isError, refetch } = useLiveGet<GreeterView>(API.greeter(event.id), [
    'events',
    'participations',
  ]);
  const [editing, setEditing] = useState(false);
  const title = data?.mentor ? 'Наставник для новичков' : 'Кто встретит новичков';

  return (
    <Panel icon={<HandWavingIcon size={22} aria-hidden />} title={title}>
      {isLoading ? (
        <PanelSkeleton />
      ) : isError || !data ? (
        <ErrorState onRetry={() => void refetch()}>Не удалось загрузить встречающего.</ErrorState>
      ) : (
        <>
          {data.greeter ? (
            <div className={styles.person}>
              <Avatar
                name={data.greeter.name}
                initials={data.greeter.initials}
                src={data.greeter.avatarUrl}
                size={40}
              />
              <div>
                <p className={styles.personName}>
                  {data.greeter.name}
                  {data.greeter.isOrganizer && <span className={styles.muted}> (организатор)</span>}
                </p>
                <p className={styles.note}>«{data.note}»</p>
              </div>
            </div>
          ) : (
            <Status tone="off">
              Назначьте того, кто встретит новых участников: себя или участника встречи. Укажите место сбора и
              приметы, по которым его можно узнать.
            </Status>
          )}

          <Newcomers list={data.newcomers ?? []} />

          {data.canManage ? (
            editing || !data.greeter ? (
              <GreeterForm view={data} onDone={() => setEditing(false)} canCancel={Boolean(data.greeter)} />
            ) : (
              <GreeterActions eventId={event.id} onEdit={() => setEditing(true)} />
            )
          ) : (
            <p className={styles.muted}>Встреча прошла или отменена, менять встречающего уже нельзя.</p>
          )}
        </>
      )}
    </Panel>
  );
}

function Newcomers({ list }: { list: NonNullable<GreeterView['newcomers']> }) {
  if (!list.length)
    return (
      <p className={styles.muted}>
        Новички отмечают «Я здесь впервые» при записи. Как только кто-то отметит, он появится здесь.
      </p>
    );
  return (
    <div>
      <p className={styles.label}>Придут впервые: {count(list.length, WORDS.person)}</p>
      <ul className={styles.newcomers}>
        {list.map((n) => (
          <li key={n.id}>
            <Avatar name={n.name} initials={n.initials} src={n.avatarUrl} size={32} />
            <span>
              {n.name}
              <span className={styles.muted}>
                {' '}
                (впервые{n.withCompanion ? ', с близким' : ''}
                {n.status === 'pending'
                  ? ', заявка ждёт решения'
                  : n.status === 'waitlist'
                    ? ', в листе ожидания'
                    : ''}
                )
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GreeterActions({ eventId, onEdit }: { eventId: string; onEdit: () => void }) {
  const { run, isPending } = useAction();
  return (
    <div className={styles.actions}>
      <Button variant="secondary" size="sm" onClick={onEdit}>
        Изменить
      </Button>
      <Button
        variant="quiet"
        size="sm"
        loading={isPending}
        onClick={() =>
          void run(API.greeter(eventId), {}, { method: 'delete', success: 'Встречающий снят' }).catch(
            () => undefined,
          )
        }
      >
        Снять встречающего
      </Button>
    </div>
  );
}

function GreeterForm({
  view,
  onDone,
  canCancel,
}: {
  view: GreeterView;
  onDone: () => void;
  canCancel: boolean;
}) {
  const { run, isPending } = useAction<GreeterView>();
  const candidates = view.candidates ?? [];
  const [userId, setUserId] = useState(view.greeter?.id || candidates[0]?.id || '');
  const [note, setNote] = useState(view.note);
  const [error, setError] = useState('');
  const whoId = useId();
  const noteId = useId();
  const save = async () => {
    setError('');
    try {
      await run(
        API.greeter(view.eventId),
        { userId, note },
        { method: 'put', silent: true, success: 'Встречающий назначен' },
      );
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <form
      className={styles.form}
      onSubmit={(ev) => {
        ev.preventDefault();
        void save();
      }}
    >
      <label htmlFor={whoId} className={styles.label}>
        Кто встречает
      </label>
      <Select
        id={whoId}
        value={userId}
        onChange={setUserId}
        options={candidates.map((c, i) => ({
          value: c.id,
          label: i === 0 ? `${c.name} (организатор)` : c.name,
        }))}
        size="large"
      />
      <label htmlFor={noteId} className={styles.label}>
        Где ждать и как узнать
      </label>
      <Input.TextArea
        id={noteId}
        value={note}
        onChange={(ev) => setNote(ev.target.value)}
        autoSize={{ minRows: 2, maxRows: 4 }}
        maxLength={200}
        placeholder="Например: у входа в зал в 10:50, в красной куртке"
        status={error ? 'error' : undefined}
        aria-describedby={error ? `${noteId}-err` : undefined}
      />
      {error && (
        <p id={`${noteId}-err`} className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="sm" loading={isPending} loadingText="Сохраняем…">
          Назначить
        </Button>
        {canCancel && (
          <Button variant="quiet" size="sm" onClick={onDone}>
            Отмена
          </Button>
        )}
      </div>
    </form>
  );
}

// ---------- С3: срочный добор ----------

function UrgentPanel({ event }: { event: EventDetails }) {
  const { data, isLoading, isError, refetch } = useLiveGet<UrgentView>(API.urgent(event.id), [
    'events',
    'participations',
  ]);
  const [editing, setEditing] = useState(false);
  const { run, isPending } = useAction<UrgentView>();

  return (
    <Panel icon={<LightningIcon size={22} aria-hidden />} title="Не хватает игроков">
      {isLoading ? (
        <PanelSkeleton />
      ) : isError || !data ? (
        <ErrorState onRetry={() => void refetch()}>Не удалось загрузить срочный добор.</ErrorState>
      ) : data.active && !editing ? (
        <>
          <Status tone="wait">
            Срочно: нужно ещё {data.remaining}. Метка видна в ленте до {formatTime(data.until)} и погаснет
            сама, когда люди запишутся.
          </Status>
          <p className={styles.muted}>
            {data.notified
              ? `Уведомление получили ${count(data.notified, WORDS.person)}: у них это направление в интересах, подходит уровень и живут рядом.`
              : 'Подходящих людей рядом пока не нашлось. Метку увидят все в ленте.'}
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)} disabled={!data.canStart}>
              Изменить число
            </Button>
            <Button
              variant="quiet"
              size="sm"
              loading={isPending}
              onClick={() =>
                void run(
                  API.urgent(event.id),
                  {},
                  { method: 'delete', success: 'Метка «Срочно» снята' },
                ).catch(() => undefined)
              }
            >
              Снять метку
            </Button>
          </div>
        </>
      ) : data.canStart ? (
        <>
          {data.need > 0 && !data.active && !editing && (
            <Status tone="ok">Метка погасла: люди записались. Если снова не хватает, позовите ещё.</Status>
          )}
          <p className={styles.muted}>
            Подходящим по направлению, уровню и району придёт уведомление, а в ленте появится метка «Срочно».
          </p>
          <UrgentForm
            eventId={event.id}
            max={data.maxNeed}
            initial={Math.min(data.remaining || 2, data.maxNeed)}
            onDone={() => setEditing(false)}
            canCancel={editing}
          />
        </>
      ) : (
        <Status tone="off">{data.reason}</Status>
      )}
    </Panel>
  );
}

function UrgentForm({
  eventId,
  max,
  initial,
  onDone,
  canCancel,
}: {
  eventId: string;
  max: number;
  initial: number;
  onDone: () => void;
  canCancel: boolean;
}) {
  const [need, setNeed] = useState(Math.max(1, initial));
  const { run, isPending } = useAction<UrgentView>();
  const id = useId();
  const submit = async () => {
    try {
      const res = await run(API.urgent(eventId), { need }, { silent: false });
      onDone();
      return res;
    } catch {
      return null;
    }
  };
  return (
    <form
      className={styles.form}
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
    >
      <span id={id} className={styles.label}>
        Сколько игроков не хватает
      </span>
      <div className={styles.stepper} role="group" aria-labelledby={id}>
        <button
          type="button"
          className={styles.stepBtn}
          onClick={() => setNeed((n) => Math.max(1, n - 1))}
          disabled={need <= 1}
          aria-label="Меньше"
        >
          <MinusIcon size={20} weight="bold" aria-hidden />
        </button>
        <output className={styles.stepValue} aria-live="polite">
          {need}
        </output>
        <button
          type="button"
          className={styles.stepBtn}
          onClick={() => setNeed((n) => Math.min(max, n + 1))}
          disabled={need >= max}
          aria-label="Больше"
        >
          <PlusIcon size={20} weight="bold" aria-hidden />
        </button>
      </div>
      <div className={styles.actions}>
        <Button type="submit" variant="primary" size="sm" loading={isPending} loadingText="Зовём…">
          Позвать игроков
        </Button>
        {canCancel && (
          <Button variant="quiet" size="sm" onClick={onDone}>
            Отмена
          </Button>
        )}
      </div>
    </form>
  );
}

// ---------- Н2: программа поддержки ветеранов ----------

function ProgramPanel({ event }: { event: EventDetails }) {
  const program = event.program ?? null;
  const [withCompanion, setWithCompanion] = useState(program?.withCompanion ?? true);
  const { run, isPending } = useAction();
  const upcoming = event.state === 'upcoming';
  const checkId = useId();
  const save = (next: boolean) =>
    run(
      API.program(event.id),
      { kind: 'veterans', withCompanion: next },
      { method: 'put', success: 'Отметка сохранена' },
    ).catch(() => undefined);

  return (
    <Panel icon={<MedalMilitaryIcon size={22} aria-hidden />} title="Программа поддержки ветеранов">
      <p className={styles.muted}>
        Отметка показывает, что встреча подходит участникам программы: в первый раз человека встретит
        наставник (его назначают выше). Кто ветеран, мы не спрашиваем и не храним.
      </p>
      {program ? <Status tone="ok">Встреча входит в программу</Status> : null}
      {upcoming ? (
        <>
          <label className={styles.check} htmlFor={checkId}>
            <input
              id={checkId}
              type="checkbox"
              checked={withCompanion}
              onChange={(ev) => {
                setWithCompanion(ev.target.checked);
                if (program) void save(ev.target.checked);
              }}
            />
            <span>Можно прийти с близким человеком</span>
          </label>
          <div className={styles.actions}>
            {program ? (
              <Button
                variant="quiet"
                size="sm"
                loading={isPending}
                onClick={() =>
                  void run(API.program(event.id), {}, { method: 'delete', success: 'Отметка снята' }).catch(
                    () => undefined,
                  )
                }
              >
                Снять отметку
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                loading={isPending}
                onClick={() => void save(withCompanion)}
              >
                Отметить встречу
              </Button>
            )}
          </div>
        </>
      ) : (
        <p className={styles.muted}>Встреча прошла или отменена, отметку менять нельзя.</p>
      )}
    </Panel>
  );
}
