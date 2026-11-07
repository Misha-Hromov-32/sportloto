import {
  CardsIcon,
  CheckIcon,
  ListBulletsIcon,
  PlusIcon,
  SignInIcon,
  UsersThreeIcon,
  XIcon,
} from '@phosphor-icons/react';
import { useList, type CrudFilter } from '@refinedev/core';
import { App, Segmented, Select } from 'antd';
import { useEffect, useId, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import { Button, Chip, EmptyState, ErrorState, SkeletonBlock } from '@/components';
import { API, useAction, useLiveRefetch, useMe } from '@/lib/api';
import { cityLocationFilters } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { useSettings } from '@/theme/useSettings';
import type { CompanionView, Identity } from '@/types/api';
import type { District } from '@/types/domain';

import { useSportsCatalog } from '../events/create/useSportsCatalog';
import switchStyles from '../events/feed/ViewSwitch.module.css';
import { CompanionsCards } from './cards/CompanionsCards';
import cardsStyles from './cards/CompanionsCards.module.css';
import { CompanionCard } from './parts/CompanionCard';
import styles from './parts/companions.module.css';
import { InviteModal } from './parts/InviteModal';
import { gatherLink } from './parts/model';
import { ReadinessSwitch } from './parts/ReadinessSwitch';
import { PersonalPage } from '../shared/PersonalPage';

type TimeKey = 'morning' | 'day' | 'evening' | 'weekdays' | 'weekend';

const TIME: { key: TimeKey; label: string; re: RegExp }[] = [
  { key: 'morning', label: 'Утром', re: /утр/ },
  { key: 'day', label: 'Днём', re: /дн[её]м|днем|день|обед/ },
  { key: 'evening', label: 'Вечером', re: /вечер|после 1[7-9]|после 2\d/ },
  { key: 'weekdays', label: 'В будни', re: /будн|понедельник|вторник|сред|четверг|пятниц/ },
  { key: 'weekend', label: 'В выходные', re: /выходн|суббот|воскрес/ },
];

const NEW_LINK = '/companions/new';

export default function CompanionsPage() {
  const city = useSelectedCity();
  const { me, role } = useMe();
  const [params, setParams] = useSearchParams();
  const sportId = params.get('sport') ?? undefined;
  const districtId = params.get('district') ?? undefined;
  const time = (params.get('time') as TimeKey | null) ?? undefined;
  const { settings } = useSettings();
  // «Режим Тиндера»: объявления карточками со свайпом. В простом режиме, как и у событий, только список.
  const cards = !settings.simple && params.get('view') === 'cards';
  const [inviteFor, setInviteFor] = useState<CompanionView | null>(null);
  const sportFilterId = useId();
  const districtFilterId = useId();

  const setFilter = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const filters: CrudFilter[] = [
    { field: 'city', operator: 'eq', value: city.name },
    ...(sportId ? [{ field: 'sportId', operator: 'eq' as const, value: sportId }] : []),
    ...(districtId ? [{ field: 'districtId', operator: 'eq' as const, value: districtId }] : []),
  ];
  const list = useList<CompanionView>({ resource: 'companions', filters, pagination: { mode: 'off' } });
  useLiveRefetch(['companions', 'users'], () => void list.query.refetch());

  const { sports } = useSportsCatalog();
  const districts = useList<District>({
    resource: 'districts',
    filters: cityLocationFilters(city, ''),
    pagination: { mode: 'off' },
  });

  const timeRe = TIME.find((t) => t.key === time)?.re;
  const items = useMemo(
    () => list.result.data.filter((c) => !c.isMine && (!timeRe || timeRe.test(c.when.toLowerCase()))),
    [list.result.data, timeRe],
  );
  const hasFilters = Boolean(sportId || districtId || time);
  const resetFilters = () => setParams(cards ? { view: 'cards' } : {}, { replace: true });
  const setView = (v: 'list' | 'cards') => {
    const next = new URLSearchParams(params);
    if (v === 'cards') next.set('view', 'cards');
    else next.delete('view');
    setParams(next);
  };
  useEffect(() => {
    if (cards) window.scrollTo({ top: 0 });
  }, [cards]);
  const isAdmin = role === 'admin';
  const newTo = me ? NEW_LINK : `/login?to=${encodeURIComponent(NEW_LINK)}`;

  const filtersPanel = (
    <section className={styles.filters} aria-label="Фильтры">
      <div className={styles.filterSelects}>
        <div className={styles.filterField}>
          <label htmlFor={sportFilterId} className={styles.filterLabel}>
            Направление
          </label>
          <Select
            id={sportFilterId}
            size="large"
            showSearch
            allowClear
            placeholder="Любое"
            value={sportId}
            onChange={(v: string | undefined) => setFilter('sport', v)}
            optionFilterProp="label"
            options={sports.map((s) => ({ value: s.id, label: s.name }))}
          />
        </div>
        <div className={styles.filterField}>
          <label htmlFor={districtFilterId} className={styles.filterLabel}>
            Район
          </label>
          <Select
            id={districtFilterId}
            size="large"
            allowClear
            placeholder="Любой"
            value={districtId}
            onChange={(v: string | undefined) => setFilter('district', v)}
            options={districts.result.data.map((d) => ({ value: d.id, label: d.name }))}
          />
        </div>
      </div>
      <div className={styles.timeChips} role="group" aria-label="Когда удобно">
        {TIME.map((t) => (
          <Chip
            key={t.key}
            selected={time === t.key}
            onClick={() => setFilter('time', time === t.key ? undefined : t.key)}
          >
            {t.label}
          </Chip>
        ))}
        {hasFilters && (
          <Button variant="quiet" size="sm" icon={<XIcon size={18} aria-hidden />} onClick={resetFilters}>
            Сбросить фильтры
          </Button>
        )}
      </div>
    </section>
  );

  if (cards)
    return (
      <div className="container">
        <h1 className="sr-only">Ищу компанию: режим Тиндера</h1>
        <CompanionsCards
          items={items}
          isLoading={list.query.isLoading}
          isError={list.query.isError}
          refetch={() => void list.query.refetch()}
          signature={JSON.stringify([city.id, sportId, districtId, time])}
          me={me}
          isAdmin={isAdmin}
          activeFilters={[sportId, districtId, time].filter(Boolean).length}
          filtersPanel={filtersPanel}
          newTo={newTo}
          onExit={() => setView('list')}
        />
      </div>
    );

  return (
    <PersonalPage
      title="Ищу компанию"
      description="Найдите партнёра для занятий спортом. Откликнитесь на объявление или пригласите автора на свою встречу."
      icon={<UsersThreeIcon size={28} />}
      summary={
        <>
          <strong>Отклик в одно нажатие</strong>Нажмите «Я тоже», и автор объявления получит уведомление.
          {me && !isAdmin && (
            <a className={styles.statusJump} href="#companion-status">
              Ваш статус и объявления
            </a>
          )}
        </>
      }
      actions={
        !isAdmin && (
          <Button variant="primary" to={newTo} icon={<PlusIcon size={20} weight="bold" aria-hidden />}>
            Написать объявление
          </Button>
        )
      }
    >
      <div className={styles.layout}>
        <div className={styles.main}>
          {filtersPanel}

          {list.query.isLoading ? (
            <div className={styles.list} role="status" aria-live="polite">
              <span className="sr-only">Загружаем объявления…</span>
              {[0, 1, 2].map((i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : list.query.isError ? (
            <ErrorState title="Не удалось загрузить объявления" onRetry={() => void list.query.refetch()} />
          ) : items.length === 0 ? (
            hasFilters ? (
              <EmptyState
                title="По этим условиям объявлений нет"
                actions={
                  <>
                    <Button variant="secondary" onClick={resetFilters}>
                      Сбросить фильтры
                    </Button>
                    {!isAdmin && (
                      <Button variant="quiet" to={newTo}>
                        Написать своё
                      </Button>
                    )}
                  </>
                }
              >
                Измените район или время поиска либо напишите своё объявление.
              </EmptyState>
            ) : (
              <EmptyState
                icon={<UsersThreeIcon size={28} aria-hidden />}
                title="Пока никто не ищет компанию"
                actions={
                  !isAdmin && (
                    <Button variant="primary" to={newTo}>
                      Написать объявление
                    </Button>
                  )
                }
              >
                Напишите первым, кого ищете и когда вам удобно. Люди рядом увидят и нажмут «Я тоже».
              </EmptyState>
            )
          ) : (
            <>
              <div className={cardsStyles.viewBar}>
                <p className={styles.total} aria-live="polite">
                  Объявлений: <span className="num">{items.length}</span>
                  {me &&
                    !isAdmin &&
                    items.some((c) => c.matchReasons.length) &&
                    ', сверху те, что подходят вам'}
                </p>
                {!settings.simple && (
                  <Segmented<'list' | 'cards'>
                    className={switchStyles.switch}
                    aria-label="Как показать объявления"
                    value="list"
                    onChange={setView}
                    options={[
                      { value: 'list', label: 'Списком', icon: <ListBulletsIcon size={18} aria-hidden /> },
                      { value: 'cards', label: 'Режим Тиндера', icon: <CardsIcon size={18} aria-hidden /> },
                    ]}
                  />
                )}
              </div>
              <CompanionList
                key={`${city.id}:${sportId}:${districtId}:${time}`}
                items={items}
                me={me}
                isAdmin={isAdmin}
                onInvite={setInviteFor}
              />
            </>
          )}
        </div>
        <aside id="companion-status" className={styles.aside}>
          {me && !isAdmin ? (
            <>
              <ReadinessSwitch me={me} />
              <MyCompanions me={me} />
            </>
          ) : !me ? (
            <section className={styles.guest}>
              <SignInIcon size={24} aria-hidden />
              <div>
                <p className={styles.blockTitle}>Войдите, чтобы откликаться</p>
                <p className="text-2">
                  Смотреть объявления можно и так. Чтобы нажать «Я тоже» или написать своё, нужен вход.
                </p>
                <Button variant="secondary" to={`/login?to=${encodeURIComponent('/companions')}`}>
                  Войти
                </Button>
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      <InviteModal companion={inviteFor} onClose={() => setInviteFor(null)} />
    </PersonalPage>
  );
}

function CompanionList({
  items,
  me,
  isAdmin,
  onInvite,
}: {
  items: CompanionView[];
  me: Identity | null;
  isAdmin: boolean;
  onInvite: (companion: CompanionView) => void;
}) {
  const [visible, setVisible] = useState(24);
  return (
    <>
      <ul className={styles.list}>
        {items.slice(0, visible).map((c) => (
          <li key={c.id}>
            <CompanionCard
              companion={c}
              actions={<OtherActions companion={c} me={me} isAdmin={isAdmin} onInvite={() => onInvite(c)} />}
            />
          </li>
        ))}
      </ul>
      {visible < items.length && (
        <Button variant="secondary" onClick={() => setVisible((value) => value + 24)}>
          Показать ещё {Math.min(24, items.length - visible)}
        </Button>
      )}
    </>
  );
}

function OtherActions({
  companion: c,
  me,
  isAdmin,
  onInvite,
}: {
  companion: CompanionView;
  me: Identity | null;
  isAdmin: boolean;
  onInvite: () => void;
}) {
  const { run, isPending } = useAction();
  if (isAdmin) return null;
  if (!me)
    return (
      <Button variant="secondary" to={`/login?to=${encodeURIComponent('/companions')}`}>
        Я тоже
      </Button>
    );
  const toggle = () =>
    void run(API.metoo(c.id), {}, { success: c.iMetoo ? 'Отклик отменён' : 'Отклик отправлен' }).catch(
      () => undefined,
    );
  return (
    <>
      {c.iMetoo ? (
        <>
          <span className={styles.metooOn}>
            <CheckIcon size={18} weight="bold" aria-hidden />
            Вы откликнулись
          </span>
          <Button variant="quiet" size="sm" onClick={toggle} loading={isPending}>
            Отменить отклик
          </Button>
        </>
      ) : (
        <Button variant="secondary" onClick={toggle} loading={isPending} loadingText="Отмечаем…">
          Я тоже
        </Button>
      )}
      <Button variant="quiet" onClick={onInvite}>
        Позвать на событие
      </Button>
    </>
  );
}

function MyCompanions({ me }: { me: Identity }) {
  const { modal } = App.useApp();
  const { run } = useAction();
  const { result, query } = useList<CompanionView>({
    resource: 'companions',
    filters: [{ field: 'mine', operator: 'eq', value: true }],
    pagination: { mode: 'off' },
    sorters: [{ field: 'createdAt', order: 'desc' }],
  });
  useLiveRefetch(['companions'], () => void query.refetch());
  const items = [...result.data].sort((a, b) => Number(b.status === 'open') - Number(a.status === 'open'));

  const close = (c: CompanionView) =>
    modal.confirm({
      title: 'Закрыть объявление?',
      content:
        c.metooCount > 0
          ? `Его перестанут видеть в поиске компании. ${c.metooCount === 1 ? 'Откликнувшийся' : 'Откликнувшиеся'} не получат уведомления.`
          : 'Его перестанут видеть в поиске компании.',
      okText: 'Закрыть объявление',
      cancelText: 'Оставить',
      onOk: () => run(API.closeCompanion(c.id), {}, { success: 'Объявление закрыто' }).catch(() => undefined),
    });

  return (
    <section className={styles.mine} aria-labelledby="mine-title">
      <h2 id="mine-title" className={styles.blockTitle}>
        Ваши объявления
      </h2>
      {query.isLoading ? (
        <SkeletonBlock height={160} />
      ) : query.isError ? (
        <ErrorState onRetry={() => void query.refetch()}>Не удалось загрузить ваши объявления.</ErrorState>
      ) : items.length === 0 ? (
        <p className="text-2">
          Пока нет. Напишите, кого ищете, {me.name.split(' ')[0]}: люди рядом увидят и откликнутся.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((c) => (
            <li key={c.id}>
              <CompanionCard
                companion={c}
                actions={
                  c.status === 'open' ? (
                    <>
                      <Button
                        variant="primary"
                        to={gatherLink(c)}
                        icon={<UsersThreeIcon size={20} aria-hidden />}
                      >
                        Собрать встречу
                      </Button>
                      <Button variant="quiet" onClick={() => close(c)}>
                        Закрыть
                      </Button>
                    </>
                  ) : null
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function CardSkeleton() {
  return (
    <div className={styles.card} aria-hidden>
      <SkeletonBlock width={160} height={20} />
      <SkeletonBlock height={18} />
      <SkeletonBlock width="70%" height={18} />
      <SkeletonBlock width={220} height={16} />
      <SkeletonBlock width={180} height={16} />
      <div className={styles.foot}>
        <SkeletonBlock width={40} height={40} radius="pill" />
        <SkeletonBlock width={140} height={16} />
      </div>
    </div>
  );
}
