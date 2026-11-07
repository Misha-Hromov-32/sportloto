import { CheckCircleIcon, LockSimpleIcon, MegaphoneIcon, UsersThreeIcon } from '@phosphor-icons/react';
import { Input, Modal, Segmented } from 'antd';
import { useId, useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';

import { Button, EmptyState, ErrorState, SkeletonBlock, SportIcon } from '@/components';
import { API, errorMessage, newIdempotencyKey, useAction, useLiveGet } from '@/lib/api';
import { cityByName, defaultCity } from '@/lib/cities';
import { formatEventDate } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { capitalize } from '@/lib/text';
import { zonedToIso } from '@/lib/timezone';
import type { DemandGroupView, DemandView, EventView, OrganizationView } from '@/types/api';

import { PillTabs } from '../../me/parts/PillTabs';
import styles from './demand.module.css';

type CabinetTab = 'events' | 'demand';

/** Кабинет допущенного клуба: «Встречи клуба» и «Спрос рядом» (С2). */
export function CabinetTabs({
  org,
  events,
  eventsBlock,
}: {
  org: OrganizationView;
  events: EventView[];
  eventsBlock: ReactNode;
}) {
  const [params, setParams] = useSearchParams();
  const tab: CabinetTab = params.get('tab') === 'demand' ? 'demand' : 'events';
  const { data } = useLiveGet<DemandView>(API.demand(org.id), ['demand', 'companions']);
  const fresh = data?.groups?.filter((g) => !g.offer).length ?? 0;
  return (
    <PillTabs<CabinetTab>
      label="Кабинет организации"
      active={tab}
      onChange={(next) =>
        setParams(next === 'demand' ? { tab: 'demand' } : {}, { replace: true, preventScrollReset: true })
      }
      tabs={[
        { key: 'events', label: 'Встречи клуба', count: events.length },
        { key: 'demand', label: 'Спрос рядом', count: fresh || undefined, attention: Boolean(fresh) },
      ]}
    >
      {tab === 'demand' ? <DemandSection org={org} events={events} /> : eventsBlock}
    </PillTabs>
  );
}

function DemandSection({ org, events }: { org: OrganizationView; events: EventView[] }) {
  const { data, isLoading, isError, refetch } = useLiveGet<DemandView>(API.demand(org.id), [
    'demand',
    'companions',
    'events',
  ]);
  const [offerFor, setOfferFor] = useState<DemandGroupView | null>(null);

  return (
    <div className={styles.section}>
      <p className={styles.intro}>
        Здесь собраны запросы из объявлений «Ищу компанию» и поиска без результатов. Видны направление, время
        и район, без имён. Предложите встречу подходящей группе — её участники получат приглашение.
      </p>
      {isLoading ? (
        <div className={styles.list} aria-hidden>
          {[0, 1].map((i) => (
            <SkeletonBlock key={i} height={140} radius="media" />
          ))}
        </div>
      ) : isError || !data?.groups ? (
        <ErrorState onRetry={() => void refetch()}>
          Не удалось загрузить спрос. Нажмите «Повторить».
        </ErrorState>
      ) : data.groups.length === 0 ? (
        <EmptyState title="Пока спроса рядом нет">
          Группа появится, когда хотя бы {data.minGroup} человека будут искать одно направление в одно время и
          в одном районе.
        </EmptyState>
      ) : (
        <>
          <ul className={styles.list}>
            {data.groups.map((g) => (
              <li key={g.key}>
                <GroupCard group={g} onOffer={() => setOfferFor(g)} />
              </li>
            ))}
          </ul>
          <p className={styles.privacy}>
            <LockSimpleIcon size={18} aria-hidden />
            {data.hidden > 0
              ? `Ещё ${count(data.hidden, WORDS.person)} в группах меньше ${data.minGroup} человек: их не показываем, чтобы никого нельзя было узнать.`
              : `Группы меньше ${data.minGroup} человек не показываем, чтобы никого нельзя было узнать.`}
          </p>
        </>
      )}
      {offerFor && (
        <OfferDialog org={org} group={offerFor} events={events} onClose={() => setOfferFor(null)} />
      )}
    </div>
  );
}

function GroupCard({ group: g, onOffer }: { group: DemandGroupView; onOffer: () => void }) {
  const where = g.districtName ?? 'весь город';
  return (
    <article className={styles.card} aria-label={`${g.sport.name}, ${g.slotLabel}, ${where}`}>
      <div className={styles.cardHead}>
        <p className={styles.cardTitle}>
          <SportIcon sport={g.sport} size={22} />
          <span>
            {g.sport.name}, {g.slotLabel}, {where}
          </span>
        </p>
        {g.ours && <span className={styles.ours}>Ваше направление</span>}
      </div>
      <p className={styles.people}>
        <UsersThreeIcon size={24} aria-hidden />
        {count(g.people, WORDS.person)}
      </p>
      <p className={styles.breakdown}>
        {[
          g.fromCompanions ? `${g.fromCompanions} написали «Ищу компанию»` : '',
          g.fromSearch ? `${g.fromSearch} искали и не нашли встречу` : '',
          g.beginners ? `новичков: ${g.beginners}` : '',
        ]
          .filter(Boolean)
          .join(', ')}
        .
      </p>
      {g.offer ? (
        <p className={styles.offered}>
          <CheckCircleIcon size={20} weight="fill" aria-hidden />
          <span>
            Вы предложили «{g.offer.title}», {formatEventDate(g.offer.startsAt).toLowerCase()}. Приглашение
            получили {count(g.offer.invited, WORDS.person)}.
          </span>
        </p>
      ) : null}
      <div className={styles.cardActions}>
        <Button
          variant={g.offer ? 'secondary' : 'primary'}
          icon={<MegaphoneIcon size={20} aria-hidden />}
          onClick={onOffer}
        >
          {g.offer ? 'Предложить ещё встречу' : 'Предложить встречу'}
        </Button>
        <span className={styles.reach}>
          {g.reachable < g.people
            ? `Приглашение получат ${g.reachable} из ${g.people}: остальные искали без входа`
            : `Приглашение получат все ${g.people}`}
        </span>
      </div>
    </article>
  );
}

type Mode = 'new' | 'existing';

function OfferDialog({
  org,
  group: g,
  events,
  onClose,
}: {
  org: OrganizationView;
  group: DemandGroupView;
  events: EventView[];
  onClose: () => void;
}) {
  const suitable = useMemo(
    () => events.filter((e) => e.sport.id === g.sport.id && e.state === 'upcoming'),
    [events, g.sport.id],
  );
  const [mode, setMode] = useState<Mode>('new');
  const [title, setTitle] = useState(g.suggestion.title);
  const [date, setDate] = useState(g.suggestion.date);
  const [time, setTime] = useState(g.suggestion.time);
  const [address, setAddress] = useState(g.suggestion.address);
  const [capacity, setCapacity] = useState(String(Math.max(g.people + 2, 6)));
  const [eventId, setEventId] = useState(suitable[0]?.id ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<{ invited: number; eventId: string } | null>(null);
  const [key] = useState(newIdempotencyKey);
  const { run, isPending } = useAction<{ eventId: string; invited: number }>();
  const ids = { title: useId(), date: useId(), time: useId(), address: useId(), capacity: useId() };
  const timeZone = (cityByName(org.city) ?? defaultCity()).timeZone;

  const submit = async () => {
    const errs: Record<string, string> = {};
    if (mode === 'new') {
      if (title.trim().length < 3) errs.title = 'Напишите название встречи';
      if (!date || !time) errs.date = 'Выберите дату и время';
      if (address.trim().length < 3) errs.address = 'Укажите адрес, где встречаетесь';
    } else if (!eventId) errs.eventId = 'Выберите встречу';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    const payload =
      mode === 'existing'
        ? { key: g.key, eventId }
        : {
            key: g.key,
            idempotencyKey: key,
            event: {
              title: title.trim(),
              startsAt: zonedToIso(date, time, timeZone),
              durationMin: 90,
              place: { address: address.trim(), districtId: g.districtId },
              capacity: Number(capacity) || null,
              joinMode: 'open',
              price: { kind: 'free' },
            },
          };
    try {
      const res = await run(API.demandOffer(org.id), payload, { silent: true });
      setDone({ invited: res.invited, eventId: res.eventId });
    } catch (error) {
      const fields = (error as { errors?: Record<string, string> }).errors;
      setErrors(
        fields
          ? {
              title: fields.title ?? '',
              date: fields.startsAt ?? fields.date ?? '',
              address: fields.place ?? fields.address ?? '',
              form: errorMessage(error),
            }
          : { form: errorMessage(error) },
      );
    }
  };

  const fullForm = `/events/new?${new URLSearchParams({
    orgId: org.id,
    sportId: g.sport.id,
    title,
    date,
    time,
    ...(g.districtId ? { districtId: g.districtId } : {}),
    ...(address ? { address } : {}),
  }).toString()}`;

  return (
    <Modal
      open
      onCancel={onClose}
      title={done ? 'Приглашения отправлены' : 'Предложить встречу'}
      footer={null}
      destroyOnHidden
    >
      {done ? (
        <div className={styles.dialog}>
          <p className={styles.offered}>
            <CheckCircleIcon size={20} weight="fill" aria-hidden />
            <span>
              {done.invited
                ? `Приглашение получили ${count(done.invited, WORDS.person)}. Записаться они смогут сразу, без заявки.`
                : 'Все из группы уже приглашены или записаны. Встреча видна в ленте.'}
            </span>
          </p>
          <div className={styles.dialogActions}>
            <Button variant="primary" to={`/events/${done.eventId}`}>
              Открыть встречу
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Закрыть
            </Button>
          </div>
        </div>
      ) : (
        <form
          className={styles.dialog}
          onSubmit={(ev) => {
            ev.preventDefault();
            void submit();
          }}
        >
          <p className={styles.dialogLead}>
            {capitalize(g.sport.name)}, {g.slotLabel}, {g.districtName ?? 'весь город'}:{' '}
            {count(g.people, WORDS.person)}. Поля заполнены по спросу, их можно поменять.
          </p>
          {suitable.length > 0 && (
            <Segmented<Mode>
              block
              value={mode}
              onChange={setMode}
              options={[
                { value: 'new', label: 'Новая' },
                { value: 'existing', label: 'Уже созданная' },
              ]}
            />
          )}
          {mode === 'new' ? (
            <>
              <Field id={ids.title} label="Название" error={errors.title}>
                <Input
                  id={ids.title}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={90}
                  size="large"
                />
              </Field>
              <div className={styles.twoCols}>
                <Field id={ids.date} label="Дата" error={errors.date}>
                  <Input
                    id={ids.date}
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    size="large"
                  />
                </Field>
                <Field id={ids.time} label="Время">
                  <Input
                    id={ids.time}
                    type="time"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    size="large"
                  />
                </Field>
              </div>
              <Field id={ids.address} label="Адрес" error={errors.address}>
                <Input
                  id={ids.address}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Например: спортзал школы № 151, ул. Молокова, 66"
                  size="large"
                />
              </Field>
              <Field id={ids.capacity} label="Мест">
                <Input
                  id={ids.capacity}
                  type="number"
                  min={2}
                  max={100}
                  value={capacity}
                  onChange={(e) => setCapacity(e.target.value)}
                  size="large"
                />
              </Field>
              <p className={styles.hint}>
                Встреча бесплатная, запись свободная. Остальное поменяете в карточке, или{' '}
                <Link to={fullForm}>заполните полную форму</Link> и потом выберите «Уже созданная».
              </p>
            </>
          ) : (
            <fieldset className={styles.pick}>
              <legend className={styles.label}>Встреча клуба</legend>
              {suitable.map((e) => (
                <label key={e.id} className={styles.pickItem}>
                  <input
                    type="radio"
                    name="offer-event"
                    checked={eventId === e.id}
                    onChange={() => setEventId(e.id)}
                  />
                  <span>
                    <strong>{e.title}</strong>
                    <span className={styles.hint}>{formatEventDate(e.startsAt)}</span>
                  </span>
                </label>
              ))}
              {errors.eventId && <p className={styles.error}>{errors.eventId}</p>}
            </fieldset>
          )}
          {errors.form && (
            <p className={styles.error} role="alert">
              {errors.form}
            </p>
          )}
          <div className={styles.dialogActions}>
            <Button type="submit" variant="primary" loading={isPending} loadingText="Отправляем…">
              {mode === 'new' ? 'Создать и пригласить' : 'Пригласить'}
            </Button>
            <Button variant="quiet" onClick={onClose}>
              Отмена
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
