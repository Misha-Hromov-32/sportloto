import { DownloadSimpleIcon, InfoIcon } from '@phosphor-icons/react';

import { Button, ErrorState, PageHeader, Section, SkeletonBlock } from '@/components';
import { COMMUNITY_API, useLiveGet } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import { formatRub } from '@/lib/money';
import type { AnalyticsDistrict, AnalyticsView } from '@/types/community';

import { AdminTable, type AdminColumn } from '../parts/AdminTable';
import adminStyles from '../parts/admin.module.css';
import styles from './analytics.module.css';
import { Bars, DailyChart, GapLegend, HeatGrid, Meter } from './Charts';
import { analyticsCsv, downloadCsv } from './csv';

const LIVE = ['events', 'participations', 'companions', 'demand', 'venues', 'organizations', 'demo'];

export default function AdminAnalyticsPage() {
  const {
    data: view,
    isLoading,
    isError,
    refetch,
  } = useLiveGet<AnalyticsView>(COMMUNITY_API.analytics, LIVE);

  const header = (
    <PageHeader
      title="Спрос и инфраструктура"
      subtitle="Где люди ищут занятия и не находят, где не хватает встреч и площадок. Только общие цифры, без имён и контактов."
      actions={
        view && (
          <Button
            variant="secondary"
            icon={<DownloadSimpleIcon size={20} aria-hidden />}
            onClick={() =>
              downloadCsv(`spros-i-infrastruktura-${dayjs().format('YYYY-MM-DD')}.csv`, analyticsCsv(view))
            }
          >
            Скачать CSV
          </Button>
        )
      }
    />
  );

  if (isError)
    return (
      <div className={adminStyles.page}>
        {header}
        <ErrorState title="Не удалось посчитать спрос" onRetry={() => void refetch()} />
      </div>
    );

  if (isLoading || !view)
    return (
      <div className={adminStyles.page} aria-busy="true">
        {header}
        <SkeletonBlock height={96} />
        <SkeletonBlock height={220} />
        <SkeletonBlock height={420} />
      </div>
    );

  const t = view.totals;
  const kpis: [string, number][] = [
    ['Поисков в ленте', t.search],
    ['Фраз помощнику', t.phrase],
    ['Ищут компанию', t.companion],
    ['Не нашли в подборе', t.failed],
    ['Мест не было, встали в очередь', t.waitlist],
    ['Встреч на месяц вперёд', t.events],
    ['Свободных окон площадок на неделю', t.freeWindows],
  ];
  const noAccessVenues = view.districts.reduce((n, r) => n + r.venuesNoAccess, 0);
  const noAccessEvents = view.districts.reduce((n, r) => n + r.eventsNoAccess, 0);
  const worst = [...view.districts].filter((r) => r.demand > 0).sort((a, b) => b.gap - a.gap)[0];

  const columns: AdminColumn<AnalyticsDistrict>[] = [
    { key: 'name', title: 'Район', primary: true, render: (r) => <strong>{r.name}</strong> },
    {
      key: 'demand',
      title: 'Спрос',
      align: 'right',
      sorter: (a, b) => a.demand - b.demand,
      render: (r) => r.demand,
    },
    {
      key: 'unmet',
      title: 'Не нашли или мест нет',
      align: 'right',
      sorter: (a, b) => a.unmet - b.unmet,
      render: (r) => r.unmet,
    },
    {
      key: 'events',
      title: 'Встреч',
      align: 'right',
      sorter: (a, b) => a.events - b.events,
      render: (r) => `${r.events}${r.paidEvents ? `, платных ${r.paidEvents}` : ''}`,
    },
    {
      key: 'venues',
      title: 'Площадки, окна на неделю',
      sorter: (a, b) => a.freeWindows - b.freeWindows,
      render: (r) => (r.venues ? `${r.venues}, окон ${r.freeWindows}` : 'нет площадок'),
    },
    {
      key: 'gap',
      title: 'Запросов на встречу',
      align: 'right',
      defaultSortOrder: 'descend',
      sorter: (a, b) => a.gap - b.gap,
      render: (r) => r.gap.toLocaleString('ru-RU'),
    },
    {
      key: 'commercial',
      title: 'Коммерческий спрос',
      sorter: (a, b) => a.commercial - b.commercial,
      render: (r) => (
        <Meter
          value={r.commercial}
          label={`Коммерческий спрос, ${r.name}: ${r.commercial} из 100${r.avgPrice ? `, средняя цена ${formatRub(r.avgPrice)}` : ''}`}
        />
      ),
    },
    {
      key: 'social',
      title: 'Общественная потребность',
      sorter: (a, b) => a.social - b.social,
      render: (r) => (
        <Meter value={r.social} label={`Общественная потребность, ${r.name}: ${r.social} из 100`} />
      ),
    },
    {
      key: 'access',
      title: 'Без доступной среды',
      render: (r) =>
        r.venuesNoAccess || r.eventsNoAccess
          ? [
              r.venuesNoAccess && `площадок ${r.venuesNoAccess} из ${r.venues}`,
              r.eventsNoAccess && `встреч ${r.eventsNoAccess} из ${r.events}`,
            ]
              .filter(Boolean)
              .join(', ')
          : r.venues || r.events
            ? 'везде есть'
            : 'нет данных',
    },
  ];

  return (
    <div className={adminStyles.page}>
      {header}

      <p className={styles.note} role="note">
        <InfoIcon size={20} aria-hidden />
        <span>
          За {view.days} дней учтены поиски, фразы помощнику, «Ищу компанию» и лист ожидания. Новые действия
          попадают сюда сразу, сейчас их {view.liveEntries}.
          {!view.venuesAvailable && ' Площадок пока нет, поэтому предложение считается только по встречам.'}
        </span>
      </p>

      <dl className={styles.kpis}>
        {kpis.map(([label, value]) => (
          <div key={label} className={styles.kpi}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>

      <Section title="Разрыв по районам и направлениям">
        <div className={styles.panel}>
          <p className={styles.sub}>
            В ячейке указаны число поисковых запросов и число встреч на ближайший месяц. Чем темнее цвет, тем
            больше запросов на одну встречу.
            {worst &&
              ` Сильнее всего встреч не хватает в районе ${worst.name}: запросов на одну встречу ${worst.gap.toLocaleString('ru-RU')}.`}
          </p>
          <GapLegend />
          <HeatGrid view={view} />
        </div>
      </Section>

      <Section title="Районы: спрос, предложение и две оценки">
        <div className={styles.panel}>
          <AdminTable
            rows={view.districts}
            rowKey={(r) => r.id}
            columns={columns}
            pageSize={20}
            caption="Районы: спрос, встречи, площадки и оценки"
            empty={null}
          />
          <details className={styles.method}>
            <summary>Как считаются оценки</summary>
            <ul>
              <li>
                <strong>Коммерческий спрос</strong> (0–100) складывается из того, сколько ищут в районе (40%),
                насколько заполнены платные встречи (30%), сколько платных встреч (20%) и какая средняя цена
                (10%). Показатель помогает сравнить спрос на платные занятия в районах. Окупаемость по нему
                определить нельзя.
              </li>
              <li>
                <strong>Общественная потребность</strong> (0–100) складывается из запросов без результата и
                очередей «мест нет» (40%), запросов для старшего поколения, детей, с сопровождением и
                бесплатных (30%), нехватки бесплатных встреч (15%) и встреч с доступной средой (15%). Помогает
                выбрать район для гранта или городской программы.
              </li>
              <li>
                Каждая часть сравнивается с районом, где значение самое большое, поэтому 100 означает максимум
                по городу.
              </li>
              <li>
                «Ищу компанию» и неудачный подбор считаются так же, как в разделе клуба «Спрос рядом»: цифры
                по одной группе совпадают.
              </li>
            </ul>
          </details>
        </div>
      </Section>

      <Section title="Доступная среда">
        <p className={styles.sub}>
          Без пандуса, лифта или туалета для маломобильных: площадок {noAccessVenues} из {t.venues}. Встреч
          без доступной среды и без сопровождения: {noAccessEvents} из {t.events}. Цифры по районам есть в
          последней колонке таблицы выше.
        </p>
      </Section>

      <Section title="Спрос по дням">
        <DailyChart view={view} />
      </Section>

      <div className={styles.twoCols}>
        <Section title="Что пишут в поиске">
          {view.phrases.length ? (
            <Bars
              label="Частые фразы поиска"
              items={view.phrases.map((p) => ({ label: p.text, value: p.count }))}
            />
          ) : (
            <p className={styles.sub}>Фразы появятся, когда одинаковый запрос повторится хотя бы дважды.</p>
          )}
        </Section>
        <Section title="Что выбирают в фильтрах">
          {view.filters.length ? (
            <Bars
              label="Частые фильтры"
              items={view.filters.map((f) => ({ label: f.label, value: f.count }))}
            />
          ) : (
            <p className={styles.sub}>Пока никто не пользовался фильтрами.</p>
          )}
        </Section>
      </div>
    </div>
  );
}
