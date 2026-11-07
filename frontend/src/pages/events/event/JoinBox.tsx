import {
  CalendarPlusIcon,
  CheckCircleIcon,
  ClockCountdownIcon,
  GearIcon,
  LockIcon,
  PencilSimpleIcon,
  PrinterIcon,
  ProhibitIcon,
  QueueIcon,
  ShieldCheckIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { useOne } from '@refinedev/core';
import { App, Input } from 'antd';
import { useId, useState, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { Button } from '@/components';
import { API, useAction, useLiveGet, useMe } from '@/lib/api';
import { formatEventDate } from '@/lib/dates';
import { JOIN_MODE, PARTICIPATION_STATUS } from '@/lib/labels';
import { cancelPolicyText, freeCancelDeadline } from '@/lib/money';
import { count, WORDS } from '@/lib/plural';
import type { EventDetails, OrganizationView, PlanBView } from '@/types/api';

import { Spots } from '../feed/FeedCard';
import { whenShort } from '../feed/filters';
import styles from './EventPage.module.css';
import { EscortOption } from '../venues/EscortOption'; // Н1
import { FirstVisitCheck, FirstVisitMemo } from '../manage/greeter/FirstVisit'; // С1, Н2
import { CompositionNote } from './participation/Composition';
import { OfferNote } from './participation/OfferNote';
import { useConflictAwareJoin } from './participation/useConflictAwareJoin';
import { ChildrenFields } from './company/Family';
import type { ChildSeat } from '@/types/domain';
import { downloadIcs } from './time';
import { EventPayDialog, EventPaymentState, LeaveRefundNote } from './payment/EventPayment';
import { isOnlinePay, splitOpensLater } from './payment/rules';

type Tone = 'ok' | 'wait' | 'off' | 'danger';

function StateNote({
  tone,
  icon,
  title,
  children,
  flash,
}: {
  tone: Tone;
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  flash?: boolean;
}) {
  return (
    <div
      key={flash ? title : undefined}
      className={[styles.state, styles[`state-${tone}`], flash && 'status-flash'].filter(Boolean).join(' ')}
    >
      <p className={styles.stateTitle}>
        {icon}
        {title}
      </p>
      {children && <div className={styles.stateText}>{children}</div>}
    </div>
  );
}

interface JoinBoxProps {
  event: EventDetails;
  /** Вернулись после входа: показать повторное подтверждение действия. */
  intent: boolean;
  onIntentDone: () => void;
  /** Статус изменился у другой стороны, пока карточка открыта. */
  flash: boolean;
}

/** Главное действие карточки: запись, заявка, лист ожидания или управление — по состоянию. */
export function JoinBox({ event: e, intent, onIntentDone, flash }: JoinBoxProps) {
  const { me } = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [children, setChildren] = useState<ChildSeat[]>([]);
  const { modal } = App.useApp();
  const { run, isPending } = useAction();
  const joinChecked = useConflictAwareJoin(run);
  const noteId = useId();
  const [applyOpen, setApplyOpen] = useState(false);
  const [note, setNote] = useState('');
  const [joinedLine, setJoinedLine] = useState('');
  const [escort, setEscort] = useState(false); // Н1
  const [firstTime, setFirstTime] = useState(false); // С1
  const [firstCompanion, setFirstCompanion] = useState(false); // Н2
  const [payOpen, setPayOpen] = useState(false);
  const online = isOnlinePay(e);

  const full = e.capacity !== null && e.counts.spotsLeft === 0;
  const mode = JOIN_MODE[e.joinMode];
  const when = formatEventDate(e.startsAt).toLowerCase();
  const invite = params.get('invite');
  const back = `/events/${e.id}${invite ? `?invite=${encodeURIComponent(invite)}` : ''}`;

  const join = async (withNote?: string) => {
    try {
      // С9: если время занято другой записью, человек решает сам; передумал — ничего не меняем
      const res = await joinChecked(e.id, {
        ...(withNote ? { note: withNote } : {}),
        ...(e.family ? { children } : {}),
        ...(firstTime ? { firstVisit: true, withCompanion: firstCompanion } : {}), // С1, Н2
      });
      if (!res) return;
      // Н1: отметка «Мне нужно сопровождение», выбранная до записи
      if (escort)
        await run(API.escort(e.id), { needed: true }, { method: 'put', silent: true }).catch(() => undefined);
      const status = res.my?.status;
      setApplyOpen(false);
      setNote('');
      onIntentDone();
      if (status === 'confirmed') setJoinedLine(`Вы идёте на «${e.title}»: ${when}.`);
      if (online && res.my?.payment?.canPay) setPayOpen(true);
    } catch {
      /* текст ошибки уже показан; карточка обновится живым обновлением */
    }
  };

  const startJoin = () => {
    if (!me) {
      navigate(`/login?to=${encodeURIComponent(`${back}${invite ? '&' : '?'}intent=join`)}`);
      return;
    }
    if (e.joinMode === 'approval' && !full) setApplyOpen(true);
    else void join();
  };

  const leave = () => {
    const status = e.my?.status;
    const late =
      status === 'confirmed' &&
      e.price.kind !== 'free' &&
      Date.now() > freeCancelDeadline(e.cancelPolicy, e.startsAt).getTime();
    const what =
      status === 'pending'
        ? 'Отозвать заявку'
        : status === 'waitlist'
          ? 'Выйти из листа ожидания'
          : 'Отменить запись';
    modal.confirm({
      title: `${what} на «${e.title}»?`,
      content: (
        <div className={styles.confirmText}>
          <p>
            {status === 'pending'
              ? 'Организатор больше не увидит вашу заявку. Потом можно отправить её снова.'
              : status === 'waitlist'
                ? 'Вы потеряете место в очереди.'
                : 'Место освободится для других. Записаться снова можно, пока есть места.'}
          </p>
          {status === 'confirmed' && <p>{cancelPolicyText(e.cancelPolicy, e.startsAt)}.</p>}
          {online && status === 'confirmed' && <LeaveRefundNote event={e} />}
          {late && (
            <p className={styles.warn}>
              Срок бесплатной отмены уже прошёл. Организатор увидит, что вы отменили поздно.
            </p>
          )}
        </div>
      ),
      okText: what,
      okButtonProps: { danger: true },
      cancelText: status === 'pending' ? 'Оставить заявку' : 'Оставить запись',
      onOk: async () => {
        await run(
          API.leaveEvent(e.id),
          {},
          { success: status === 'pending' ? 'Заявка отозвана' : 'Запись отменена' },
        );
        setJoinedLine('');
      },
    });
  };

  const spots = (
    <Spots
      counts={e.counts}
      capacity={e.capacity}
      minParticipants={e.minParticipants}
      className={styles.joinSpots}
    />
  );

  // Организатор
  if (e.isOrganizer) {
    const open = e.state === 'upcoming' || e.state === 'live';
    return (
      <div className={styles.join}>
        {spots}
        <StateNote
          tone="ok"
          icon={<ShieldCheckIcon size={20} weight="fill" aria-hidden />}
          title="Это ваше событие"
        >
          {e.counts.pending > 0
            ? `Ждут решения: ${count(e.counts.pending, WORDS.application)}.`
            : e.joinMode === 'approval'
              ? 'Новых заявок нет.'
              : 'Участники записываются сами, решать ничего не нужно.'}
        </StateNote>
        <div className={styles.joinActions}>
          <Button
            variant="primary"
            block
            to={`/events/${e.id}/manage`}
            icon={<GearIcon size={20} aria-hidden />}
          >
            Управление
          </Button>
          {e.state === 'upcoming' && (
            <Button
              variant="secondary"
              block
              to={`/events/${e.id}/edit`}
              icon={<PencilSimpleIcon size={20} aria-hidden />}
            >
              Изменить
            </Button>
          )}
          {open && (
            <Button
              variant="quiet"
              to={`/events/${e.id}/poster`}
              icon={<PrinterIcon size={20} aria-hidden />}
            >
              Распечатать афишу
            </Button>
          )}
        </div>
      </div>
    );
  }

  // Администратор
  if (e.can.moderate) {
    return (
      <div className={styles.join}>
        {spots}
        <StateNote tone="off" icon={<ShieldCheckIcon size={20} aria-hidden />} title="Вы администратор">
          Администратор не записывается на события и не рассматривает заявки участников.
        </StateNote>
        <div className={styles.joinActions}>
          <Button variant="secondary" block to={`/admin/events/${e.id}`}>
            Открыть в администрировании
          </Button>
        </div>
      </div>
    );
  }

  const my = e.my;
  const status = my?.status;
  const statusNote = (() => {
    if (!my) return null;
    const label = PARTICIPATION_STATUS[my.status].label;
    switch (my.status) {
      case 'confirmed':
        return (
          <StateNote
            tone="ok"
            icon={<CheckCircleIcon size={20} weight="fill" aria-hidden />}
            title={label}
            flash={flash}
          >
            {joinedLine || `Вас ждут: ${when}.`}
          </StateNote>
        );
      case 'pending':
        return (
          <StateNote
            tone="wait"
            icon={<ClockCountdownIcon size={20} weight="fill" aria-hidden />}
            title={label}
            flash={flash}
          >
            <p>Вы ещё не участник. Организатор посмотрит заявку и ответит здесь, мы пришлём уведомление.</p>
            {my.note && <p className={styles.quoteNote}>Ваше сообщение: «{my.note}»</p>}
            <ol className={styles.steps} aria-label="Ход заявки">
              <li className={styles.stepDone}>Отправлена</li>
              <li className={styles.stepNow}>Рассматривается</li>
              <li>Решение</li>
            </ol>
          </StateNote>
        );
      case 'waitlist':
        // С4: освободилось место и оно придержано — «Иду» или «Отказаться»
        if (my.offerUntil) return <OfferNote event={e} flash={flash} />;
        return (
          <StateNote
            tone="wait"
            icon={<QueueIcon size={20} weight="fill" aria-hidden />}
            title={`${label}${my.waitlistPosition ? `, ${my.waitlistPosition}-й` : ''}`}
            flash={flash}
          >
            {e.joinMode === 'open'
              ? 'Если кто-то откажется, место придержим для вас и напишем. Останется только подтвердить.'
              : 'Если место освободится, ваша заявка уйдёт организатору, и мы напишем.'}
          </StateNote>
        );
      case 'rejected':
        return (
          <StateNote
            tone="danger"
            icon={<XCircleIcon size={20} weight="fill" aria-hidden />}
            title={label}
            flash={flash}
          >
            <p>
              {my.rejectReason
                ? `Причина: ${my.rejectReason}`
                : 'Организатор не указал причину. Так бывает, когда состав уже собран.'}
            </p>
            <p>
              <Link to={`/events?sport=${e.sportId}`}>Посмотреть похожие события</Link>
            </p>
          </StateNote>
        );
      case 'cancelled':
        return (
          <StateNote tone="off" icon={<XCircleIcon size={20} aria-hidden />} title={label}>
            {e.can.join ? 'Можно записаться снова, пока есть места.' : null}
          </StateNote>
        );
      case 'event_removed':
        return (
          <StateNote tone="off" icon={<ProhibitIcon size={20} aria-hidden />} title={label}>
            Событие снято с публикации. Если его вернут, запись восстановится сама.
          </StateNote>
        );
      case 'removed':
        return (
          <StateNote tone="off" icon={<ProhibitIcon size={20} aria-hidden />} title={label} flash={flash}>
            <p>
              {my.removedReason ? `Причина: ${my.removedReason}` : 'Записаться на эту встречу снова нельзя.'}
            </p>
            {e.can.joinCode === 'organizer_blocked' && <p>{e.can.joinReason}</p>}
          </StateNote>
        );
    }
  })();
  // D-16: организатор ограничил запись — вместо кнопки спокойное объяснение и похожие встречи
  const stopBlocked =
    !e.can.join && (e.can.joinCode === 'organizer_blocked' || e.can.joinCode === 'removed_before');
  const blockedNote =
    stopBlocked && status !== 'removed' && (!my || status === 'cancelled' || status === 'rejected') ? (
      <StateNote tone="off" icon={<LockIcon size={20} aria-hidden />} title="Запись для вас закрыта">
        {e.can.joinReason}
      </StateNote>
    ) : null;

  const canLeave =
    e.can.leave &&
    (status === 'confirmed' || status === 'pending' || status === 'waitlist') &&
    !my?.offerUntil;
  const leaveLabel =
    status === 'pending'
      ? 'Отозвать заявку'
      : status === 'waitlist'
        ? 'Выйти из листа ожидания'
        : 'Отменить запись';

  const payNow = online && !full && e.joinMode === 'open' && !splitOpensLater(e);
  const actionLabel = full ? 'Встать в лист ожидания' : payNow ? 'Записаться и оплатить' : mode.action;
  const actionHint = full
    ? `Мест нет. Вы будете ${e.counts.waitlist + 1}-м в очереди.`
    : online && e.joinMode === 'approval'
      ? 'Запись по заявке. Платить нужно после одобрения, по СБП или картой на сайте.'
      : online && !payNow
        ? 'Вы сразу попадёте в состав. Оплата доли откроется за неделю до встречи, мы напомним.'
        : payNow
          ? 'После записи откроется оплата по СБП или картой. Место держим, пока вы платите.'
          : e.joinMode === 'open'
            ? 'Свободная запись: вы сразу попадёте в состав участников.'
            : 'Запись по заявке: организатор посмотрит её и ответит. До ответа вы ещё не участник.';

  return (
    <div className={styles.join}>
      {spots}
      <div aria-live="polite">{statusNote}</div>
      {online && (
        <div id="pay">
          <EventPaymentState event={e} onPay={() => setPayOpen(true)} />
        </div>
      )}
      {me && <EscortOption event={e} value={escort} onChange={setEscort} />}
      {me && e.can.join && e.family && (
        <ChildrenFields family={e.family} value={children} onChange={setChildren} />
      )}
      <FirstVisitCheck
        event={e}
        checked={firstTime}
        onChange={setFirstTime}
        withCompanion={firstCompanion}
        onCompanion={setFirstCompanion}
      />

      {e.can.join &&
        (intent && me ? (
          e.joinMode === 'approval' && !full ? (
            <ApplyForm
              id={noteId}
              title={`Отправить заявку на «${e.title}»?`}
              note={note}
              setNote={setNote}
              pending={isPending}
              onSubmit={() => void join(note.trim())}
              onCancel={onIntentDone}
            />
          ) : (
            <div className={styles.confirm}>
              <p className={styles.confirmTitle}>
                {full ? 'Встать в лист ожидания' : 'Записаться'} на «{e.title}»?
              </p>
              <p className={styles.confirmWhen}>{formatEventDate(e.startsAt)}</p>
              <div className={styles.joinActions}>
                <Button
                  variant="primary"
                  size="lg"
                  block
                  autoFocus
                  loading={isPending}
                  loadingText="Записываем…"
                  onClick={() => void join()}
                >
                  {actionLabel}
                </Button>
                <Button variant="quiet" onClick={onIntentDone}>
                  Не сейчас
                </Button>
              </div>
            </div>
          )
        ) : applyOpen ? (
          <ApplyForm
            id={noteId}
            note={note}
            setNote={setNote}
            pending={isPending}
            onSubmit={() => void join(note.trim())}
            onCancel={() => setApplyOpen(false)}
          />
        ) : (
          <>
            <Button
              variant="primary"
              size="lg"
              block
              loading={isPending}
              loadingText={e.joinMode === 'approval' ? 'Отправляем…' : 'Записываем…'}
              onClick={startJoin}
              className={styles.mainBtn}
            >
              {actionLabel}
            </Button>
            <p className={styles.hint}>
              {actionHint}
              {!me && ' Сначала войдите, потом вернём вас сюда.'}
            </p>
          </>
        ))}

      {blockedNote}
      {stopBlocked && e.state === 'upcoming' && <SimilarMeetings event={e} />}

      {!e.can.join &&
        !stopBlocked &&
        (!my || status === 'cancelled') &&
        (me && e.state === 'upcoming' && e.composition && e.composition !== 'mixed' ? (
          // В7: встреча только для женщин или только для мужчин
          <CompositionNote event={e} onContinue={startJoin} />
        ) : (
          !my && (
            <StateNote tone="off" icon={<LockIcon size={20} aria-hidden />} title="Записаться нельзя">
              {e.can.joinReason}
            </StateNote>
          )
        ))}

      {canLeave && (
        <Button variant="quiet" size="sm" onClick={leave} className={styles.leave}>
          {leaveLabel}
        </Button>
      )}
      {status === 'confirmed' && e.state === 'upcoming' && (
        <p className={styles.hint}>{cancelPolicyText(e.cancelPolicy, e.startsAt)}</p>
      )}
      {online && <EventPayDialog event={e} open={payOpen} onClose={() => setPayOpen(false)} />}
    </div>
  );
}

/** Похожие встречи (как в плане Б), когда на эту записаться нельзя. */
function SimilarMeetings({ event: e }: { event: EventDetails }) {
  const { data, isLoading } = useLiveGet<PlanBView>(API.alternatives(e.id), ['events', 'participations']);
  const list = data?.alternatives ?? [];
  return (
    <div className={styles.similar}>
      <p className={styles.similarTitle}>Похожие встречи</p>
      {isLoading ? (
        <p className={styles.hint}>Подбираем…</p>
      ) : list.length ? (
        <ul className={styles.similarList}>
          {list.map((x) => (
            <li key={x.id}>
              <Link to={`/events/${x.id}`}>{x.title}</Link>
              <span className={styles.hint}>
                {whenShort(x.startsAt)}, {x.place.address}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.hint}>В ближайшие дни похожих встреч со свободными местами нет.</p>
      )}
      <Link to={`/events?sport=${e.sportId}`}>Все встречи «{e.sport.name}»</Link>
    </div>
  );
}

function ApplyForm({
  id,
  title,
  note,
  setNote,
  pending,
  onSubmit,
  onCancel,
}: {
  id: string;
  title?: string;
  note: string;
  setNote: (v: string) => void;
  pending: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  return (
    <form
      className={styles.confirm}
      onSubmit={(ev) => {
        ev.preventDefault();
        onSubmit();
      }}
    >
      {title && <p className={styles.confirmTitle}>{title}</p>}
      <label htmlFor={id} className={styles.fieldLabel}>
        Сообщение организатору <span className={styles.optional}>необязательно</span>
      </label>
      <Input.TextArea
        id={id}
        value={note}
        onChange={(ev) => setNote(ev.target.value)}
        autoSize={{ minRows: 3, maxRows: 6 }}
        maxLength={300}
        placeholder="Например: играю два года, могу прийти со своим мячом"
        autoFocus
      />
      <div className={styles.joinActions}>
        <Button type="submit" variant="primary" size="lg" block loading={pending} loadingText="Отправляем…">
          Отправить заявку
        </Button>
        <Button variant="quiet" onClick={onCancel}>
          Не отправлять
        </Button>
      </div>
    </form>
  );
}

/** «Что дальше» для участника: как найти, что взять, календарь, контакты, афиша. */
export function WhatNext({ event: e }: { event: EventDetails }) {
  const orgId = e.organizer.kind === 'org' ? e.organizer.id : null;
  const { result: org } = useOne<OrganizationView>({
    resource: 'organizations',
    id: orgId ?? '',
    queryOptions: { enabled: Boolean(orgId) },
  });
  const rows: { label: string; value: ReactNode }[] = [];
  const find = [e.place.landmark, e.firstStep.howToFind].filter(Boolean).join('. ');
  if (find) rows.push({ label: 'Как найти', value: find });
  if (e.firstStep.bring) rows.push({ label: 'Что взять', value: e.firstStep.bring });
  const contacts = org ? [org.contacts.phone, org.contacts.email].filter(Boolean).join(', ') : '';
  rows.push({
    label: 'Связь с организатором',
    value: (
      <>
        {contacts && <span className={styles.block}>{contacts}</span>}
        <a href="#discussion">Написать в обсуждении</a> или{' '}
        <Link to={e.organizerView.link}>открыть страницу организатора</Link>
      </>
    ),
  });

  return (
    <section className={styles.next} aria-labelledby="next-title">
      <h2 id="next-title" className={styles.sideTitle}>
        Что дальше
      </h2>
      <FirstVisitMemo event={e} />
      <dl className={styles.nextList}>
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <div className={styles.nextActions}>
        <Button
          variant="secondary"
          icon={<CalendarPlusIcon size={20} aria-hidden />}
          onClick={() => downloadIcs(e)}
        >
          Добавить в календарь
        </Button>
        <Button variant="quiet" icon={<PrinterIcon size={20} aria-hidden />} to={`/events/${e.id}/poster`}>
          Распечатать афишу
        </Button>
      </div>
    </section>
  );
}
