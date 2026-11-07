import { ArrowLeftIcon, PlusIcon, PackageIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router';

import { Button, NoAccessState } from '@/components';
import { PersonalPage } from '../shared/PersonalPage';
import { useEventGear, useInventoryMe, useMe } from '@/lib/api';
import type { GearKind } from '@/types/inventory';
import { PillTabs } from '@/pages/me/parts/PillTabs';
import { NeedsBoard } from '@/pages/orgs/needs/NeedsBoard';

import styles from './inventory.module.css';
import { GEAR_KIND, quoted } from './labels';
import { MineTab } from './MineTab';
import type { RequestContext } from './RequestDialog';
import { ShelfItemDialog } from './ShelfItemDialog';
import { ShelfTab } from './ShelfTab';

type TabKey = 'shelf' | 'needs' | 'mine';
const TABS: TabKey[] = ['shelf', 'needs', 'mine'];

/**
 * Общая полка инвентаря и просьбы клубов о помощи. «Моя полка» доступна из главной навигации;
 * сюда также ведут «Найти у других» из события и кабинет клуба.
 */
export default function InventoryPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const { me: identity, isGuest } = useMe();
  const { me } = useInventoryMe();
  const raw = params.get('tab') as TabKey | null;
  const tab: TabKey = raw && TABS.includes(raw) ? raw : 'shelf';
  const eventId = params.get('event') ?? '';
  const lineId = params.get('line');
  const kindParam = params.get('kind') as GearKind | null;
  const { gear } = useEventGear(tab === 'shelf' ? eventId : '');
  const line = gear?.lines.find((l) => l.id === lineId) ?? null;
  const [sharing, setSharing] = useState(false);
  const admin = identity?.role === 'admin';
  const canShare = !isGuest && !admin;

  const context: RequestContext | null =
    gear && eventId && gear.can.request
      ? {
          eventId: gear.eventId,
          eventTitle: gear.eventTitle,
          lineId: line?.id ?? null,
          missing: line?.missing ?? 0,
        }
      : null;

  const setTab = (next: TabKey) => {
    const p = new URLSearchParams(params);
    p.set('tab', next);
    if (next !== 'shelf') {
      p.delete('event');
      p.delete('line');
      p.delete('kind');
    }
    setParams(p, { replace: true });
  };

  const loginTo = `${location.pathname}${location.search}`;

  return (
    <PersonalPage
      title="Полка инвентаря"
      description="Клубы, партнёры и соседи дают вещи на время. Найдите нужное для своей встречи или поделитесь тем, что есть у вас."
      icon={<PackageIcon size={28} />}
      summary={
        <>
          <strong>Как попросить</strong>Выберите вещь и событие, на которое она нужна. Владелец ответит в
          уведомлениях.
        </>
      }
      actions={
        canShare ? (
          <Button
            variant="primary"
            icon={<PlusIcon size={20} aria-hidden />}
            onClick={() => setSharing(true)}
          >
            Поделиться вещью
          </Button>
        ) : undefined
      }
    >
      {gear && eventId && (
        <Link to={`/events/${gear.eventId}#inventory`} className={styles.back}>
          <ArrowLeftIcon size={20} aria-hidden />
          Вернуться к событию
        </Link>
      )}

      {tab === 'shelf' && gear && eventId && (
        <div className={styles.context} role="status">
          <p>
            Ищем для события <b>«{gear.eventTitle}»</b>
            {line
              ? line.missing > 0
                ? `: «${line.name}», не хватает ${line.missing}`
                : `: «${line.name}» уже собрали`
              : ''}
            .
          </p>
          {line && line.loans.some((l) => l.mine && l.status === 'pending') && (
            <p className={styles.muted}>
              Вы уже попросили у{' '}
              {line.loans
                .filter((l) => l.mine && l.status === 'pending')
                .map((l) => quoted(l.from.name))
                .join(', ')}
              , ждём ответа.
            </p>
          )}
          {!gear.can.request && (
            <p className={styles.muted}>Попросить вещь на это событие могут его участники и организатор.</p>
          )}
        </div>
      )}

      <PillTabs<TabKey>
        label="Разделы полки"
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'shelf', label: 'Полка' },
          { key: 'needs', label: 'Нужна помощь' },
          {
            key: 'mine',
            label: 'Моя полка',
            count: me?.incomingPending || undefined,
            attention: Boolean(me?.incomingPending),
          },
        ]}
      >
        {tab === 'shelf' && (
          <ShelfTab
            key={`${eventId}-${lineId ?? ''}`}
            me={admin ? null : me}
            isGuest={isGuest}
            loginTo={loginTo}
            context={context}
            initialKind={kindParam && kindParam in GEAR_KIND ? kindParam : null}
            sportId={null}
            onShare={canShare ? () => setSharing(true) : null}
          />
        )}
        {tab === 'needs' && <NeedsBoard me={me} />}
        {tab === 'mine' &&
          (isGuest ? (
            <NoAccessState title="Войдите, чтобы увидеть свою полку" guest loginTo={loginTo} layout="inline">
              Здесь ваши вещи, просьбы к вам и ваши просьбы к другим.
            </NoAccessState>
          ) : admin ? (
            <NoAccessState title="У администратора нет своей полки" layout="inline">
              Полку ведут пользователи и организации. Администратор видит общую полку и просьбы клубов.
            </NoAccessState>
          ) : (
            <MineTab me={me} onShare={() => setSharing(true)} />
          ))}
      </PillTabs>

      <ShelfItemDialog open={sharing} item={null} me={me} onClose={() => setSharing(false)} />
    </PersonalPage>
  );
}
