import {
  CaretDownIcon,
  CheckIcon,
  HandHeartIcon,
  MagnifyingGlassIcon,
  MinusIcon,
  PencilSimpleIcon,
  PlusIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';

import { Button, ErrorState, SkeletonBlock, StatusBadge } from '@/components';
import { INVENTORY_API, useAction, useEventGear, useInventoryMe } from '@/lib/api';
import type { StatusMeta } from '@/lib/labels';
import type { EventGearView, GearLineView } from '@/types/inventory';
import { GearPicture } from '@/pages/inventory/GearPicture';
import { quoted } from '@/pages/inventory/labels';
import { RentHints } from '@/pages/inventory/RentHints';
import { NeedDialog, type NeedPreset } from '@/pages/orgs/needs/NeedDialog';
import { SupportPlaque } from '@/pages/orgs/needs/SupportedBy';

import styles from './inventory.module.css';

const ENOUGH: StatusMeta = { label: 'Хватает', tone: 'ok', icon: 'check' };
const missingMeta = (n: number): StatusMeta => ({ label: `Не хватает: ${n}`, tone: 'wait', icon: 'clock' });

/**
 * «Что нужно для игры» в карточке события: что нужно, кто что принесёт, что дадут с полки
 * и чего не хватает. Участник отмечает «Возьму с собой», недостающее можно попросить у других.
 */
export function EventInventory({ eventId, orgId }: { eventId: string; orgId: string | null }) {
  const { gear, isLoading, isError, refetch } = useEventGear(eventId);
  const ref = useRef<HTMLElement>(null);
  const { hash } = useLocation();
  const ready = Boolean(gear);
  useEffect(() => {
    if (!ready || hash !== '#inventory') return;
    // Карта и обложка выше догружаются позже и сдвигают страницу — прокручиваем после них.
    const timer = window.setTimeout(() => ref.current?.scrollIntoView({ block: 'start' }), 400);
    return () => window.clearTimeout(timer);
  }, [ready, hash]);

  if (isLoading)
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">Загружаем список инвентаря…</span>
        <SkeletonBlock height={120} radius="media" />
      </div>
    );
  if (isError || !gear)
    return (
      <ErrorState title="Не удалось загрузить список инвентаря" onRetry={() => void refetch()}>
        Остальные сведения о событии на месте. Нажмите «Повторить».
      </ErrorState>
    );
  const closedBy = gear.support.filter((n) => n.status === 'closed' && n.closedBy).map((n) => n.closedBy!);
  const openNeeds = gear.support.filter((n) => n.status === 'open');
  if (!gear.lines.length && !gear.support.length && !gear.can.edit)
    return (
      <p className={styles.hint}>
        Нужны вещи для занятия? <Link to="/inventory">Найти инвентарь на общей полке</Link>
      </p>
    );

  return (
    <section ref={ref} id="inventory" className={styles.root} aria-labelledby="inventory-title">
      <h2 id="inventory-title" className={styles.title}>
        Что нужно для игры
        {gear.lines.length > 0 && (
          <span className={styles.titleAside}>
            {gear.totals.missing > 0 ? `не хватает ${gear.totals.missing}` : 'всё собрано'}
          </span>
        )}
      </h2>

      {gear.lines.length === 0 ? (
        gear.can.edit && (
          <div className={styles.empty}>
            <p>
              Добавьте, что нужно для игры: мячи, ракетки, манишки. Участники отметят, кто что принесёт, а
              недостающее можно попросить у клубов и соседей.
            </p>
            <Button
              size="sm"
              variant="secondary"
              to={`/events/${gear.eventId}/edit`}
              icon={<PlusIcon size={18} aria-hidden />}
            >
              Добавить список
            </Button>
          </div>
        )
      ) : (
        <ul className={styles.lines}>
          {gear.lines.map((line) => (
            <GearRow key={line.id} gear={gear} line={line} />
          ))}
        </ul>
      )}

      <p className={styles.hint}>
        Клубы и участники дают вещи на время. <Link to="/inventory">Найти инвентарь на общей полке</Link>
      </p>
      {gear.pledgeHint && gear.lines.length > 0 && <p className={styles.hint}>{gear.pledgeHint}</p>}

      {closedBy.length > 0 && <SupportPlaque orgs={closedBy} />}
      {openNeeds.map((n) => (
        <p key={n.id} className={styles.supportOpen}>
          <HandHeartIcon size={20} aria-hidden />
          <span>
            Клуб попросил партнёров о помощи: «{n.title}».{' '}
            <Link to="/inventory?tab=needs">Посмотреть просьбу</Link>
          </span>
        </p>
      ))}

      {gear.totals.missing > 0 && gear.state === 'upcoming' && (
        <details className={styles.rent}>
          <summary>
            <CaretDownIcon size={18} weight="bold" aria-hidden className={styles.caret} />
            Где взять напрокат или купить
          </summary>
          <RentHints title="Если ни у кого нет" />
        </details>
      )}

      {(gear.can.edit || gear.can.askSponsors) && <OrganizerTools gear={gear} orgId={orgId} />}
    </section>
  );
}

function GearRow({ gear, line }: { gear: EventGearView; line: GearLineView }) {
  const enough = line.missing === 0;
  const given = line.loans.filter((l) => l.status === 'accepted' || l.status === 'returned');
  const asked = line.loans.filter((l) => l.status === 'pending');
  const findLink = `/inventory?event=${gear.eventId}&line=${line.id}&kind=${line.kind}`;
  return (
    <li className={styles.line}>
      <GearPicture kind={line.kind} name={line.name} size="row" />
      <div className={styles.lineBody}>
        <div className={styles.lineHead}>
          <span className={styles.lineName}>
            {line.name}
            <span className={styles.lineQty}>
              нужно {line.quantity}, есть {Math.min(line.covered, line.quantity)}
            </span>
          </span>
          <StatusBadge kind="custom" meta={enough ? ENOUGH : missingMeta(line.missing)} />
        </div>
        {(line.pledges.length > 0 || given.length > 0 || asked.length > 0) && (
          <ul className={styles.who}>
            {line.pledges.map((p) => (
              <li key={p.person.id}>
                {p.mine ? 'Вы' : p.person.name} — {p.quantity}
              </li>
            ))}
            {given.map((l) => (
              <li key={l.id}>
                {l.quantity} — от <Link to={l.from.link}>{quoted(l.from.name)}</Link>
                {l.status === 'returned' && ', уже вернули'}
              </li>
            ))}
            {asked.map((l) => (
              <li key={l.id} className={styles.asked}>
                {l.quantity} — попросили у <Link to={l.from.link}>{quoted(l.from.name)}</Link>, ждём ответа
              </li>
            ))}
          </ul>
        )}
        {(gear.can.pledge || (!enough && gear.state === 'upcoming')) && (
          <div className={styles.lineActions}>
            {gear.can.pledge && <PledgeControl eventId={gear.eventId} line={line} />}
            {!enough && gear.state === 'upcoming' && (
              <Button
                size="sm"
                variant="quiet"
                to={gear.can.request ? findLink : `/inventory?kind=${line.kind}`}
                icon={<MagnifyingGlassIcon size={18} aria-hidden />}
              >
                Найти у других
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** «Возьму с собой»: одно касание для одной вещи, кнопки − и + для нескольких. */
function PledgeControl({ eventId, line }: { eventId: string; line: GearLineView }) {
  const { run, isPending } = useAction<EventGearView>();
  const [editing, setEditing] = useState(false);
  const max = Math.max(line.myPledge, line.myPledge + line.missing);
  const [value, setValue] = useState(Math.max(1, Math.min(line.myPledge || 1, max)));
  const save = (quantity: number) =>
    run(
      INVENTORY_API.pledge(eventId, line.id),
      { quantity },
      {
        method: 'put',
        success: quantity ? `Отмечено: возьмёте ${quantity}` : 'Отметка снята',
      },
    )
      .then(() => setEditing(false))
      .catch(() => undefined);

  if (!editing) {
    if (line.myPledge > 0)
      return (
        <div className={styles.pledged}>
          <span className={styles.pledgedText}>
            <CheckIcon size={18} weight="bold" aria-hidden />
            Вы берёте: {line.myPledge}
          </span>
          <Button
            size="sm"
            variant="quiet"
            icon={<PencilSimpleIcon size={18} aria-hidden />}
            onClick={() => {
              setValue(line.myPledge);
              setEditing(true);
            }}
          >
            Изменить
          </Button>
          <Button size="sm" variant="quiet" loading={isPending} onClick={() => void save(0)}>
            Не возьму
          </Button>
        </div>
      );
    if (line.missing === 0) return null;
    return (
      <Button
        size="sm"
        variant="secondary"
        loading={isPending}
        onClick={() => {
          if (max === 1) return void save(1);
          setValue(1);
          setEditing(true);
        }}
      >
        Возьму с собой
      </Button>
    );
  }
  return (
    <div className={styles.stepper} role="group" aria-label={`Сколько возьмёте: ${line.name}`}>
      <span className={styles.stepperLabel}>Сколько возьмёте</span>
      <button
        type="button"
        className={styles.stepBtn}
        onClick={() => setValue((v) => Math.max(1, v - 1))}
        disabled={value <= 1}
        aria-label="Меньше"
      >
        <MinusIcon size={18} weight="bold" aria-hidden />
      </button>
      <output className={styles.stepValue} aria-live="polite">
        {value}
      </output>
      <button
        type="button"
        className={styles.stepBtn}
        onClick={() => setValue((v) => Math.min(max, v + 1))}
        disabled={value >= max}
        aria-label="Больше"
      >
        <PlusIcon size={18} weight="bold" aria-hidden />
      </button>
      <Button
        size="sm"
        variant="primary"
        loading={isPending}
        loadingText="Сохраняем…"
        onClick={() => void save(value)}
      >
        Сохранить
      </Button>
      <Button size="sm" variant="quiet" onClick={() => setEditing(false)}>
        Отмена
      </Button>
    </div>
  );
}

function OrganizerTools({ gear, orgId }: { gear: EventGearView; orgId: string | null }) {
  const { me } = useInventoryMe();
  const [preset, setPreset] = useState<NeedPreset | null>(null);
  const missing = gear.lines.filter((l) => l.missing > 0);
  const title = missing.length
    ? `Нужны для «${gear.eventTitle}»: ${missing.map((l) => `${l.name.toLowerCase()} — ${l.missing}`).join(', ')}`
    : '';
  const clubs = (me?.clubs ?? []).filter((c) => c.id === orgId);
  return (
    <div className={styles.tools}>
      {gear.can.edit && gear.lines.length > 0 && (
        <Button
          size="sm"
          variant="quiet"
          to={`/events/${gear.eventId}/edit`}
          icon={<PencilSimpleIcon size={18} aria-hidden />}
        >
          Изменить список
        </Button>
      )}
      {gear.can.askSponsors && orgId && clubs.length > 0 && (
        <Button
          size="sm"
          variant="quiet"
          icon={<HandHeartIcon size={18} aria-hidden />}
          onClick={() => setPreset({ orgId, eventId: gear.eventId, title: title.slice(0, 140) })}
        >
          Попросить партнёров о помощи
        </Button>
      )}
      <NeedDialog open={Boolean(preset)} clubs={clubs} preset={preset} onClose={() => setPreset(null)} />
    </div>
  );
}
