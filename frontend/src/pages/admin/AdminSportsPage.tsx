import { ArrowsMergeIcon, MagnifyingGlassIcon, PlusIcon, StarIcon } from '@phosphor-icons/react';
import { useList, useMany } from '@refinedev/core';
import { Checkbox, Form, Input, Modal, Select } from 'antd';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  SkeletonText,
  SPORT_ICON_NAMES,
  SPORT_ICONS,
  SportIcon,
} from '@/components';
import { API, useAction, useLiveGet, useLiveRefetch } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { normalize } from '@/lib/text';
import type { CategoryView, PersonShort, SportSuggestion, SportView } from '@/types/api';

import { AdminTable, type AdminColumn } from './parts/AdminTable';
import styles from './parts/admin.module.css';
import { quoted } from './parts/labels';

type SportDetails = SportView & {
  mergedInto: string | null;
  createdBy: PersonShort | null;
  createdAt: string;
  eventsCount: number;
  similar: SportSuggestion[];
};

export default function AdminSportsPage() {
  const { result: categoriesRes, query: categoriesQuery } = useList<CategoryView>({
    resource: 'categories',
    pagination: { mode: 'off' },
  });
  useLiveRefetch(['sports'], () => void categoriesQuery.refetch());
  const { result: sportsRes, query: sportsQuery } = useList<SportView>({
    resource: 'sports',
    pagination: { mode: 'off' },
  });
  const { data: eventCounts } = useLiveGet<{ bySport: Record<string, number> }>(
    '/admin/events-summary', ['events', 'sports'],
  );

  const sports = useMemo(() => sportsRes?.data ?? [], [sportsRes]);
  const customIds = sports.filter((s) => s.kind === 'custom').map((s) => s.id);
  const { result: customRes, query: customQuery } = useMany<SportDetails>({
    resource: 'sports',
    ids: customIds,
    queryOptions: { enabled: customIds.length > 0 },
  });
  const custom = (customRes?.data ?? []).filter((s) => s.kind === 'custom' && !s.mergedInto);

  const eventsBySport = useMemo(() => {
    return new Map(Object.entries(eventCounts?.bySport ?? {}));
  }, [eventCounts]);

  const [promote, setPromote] = useState<SportDetails | null>(null);
  const [merge, setMerge] = useState<SportDetails | null>(null);
  const [q, setQ] = useState('');

  const categories = categoriesRes?.data ?? [];
  const catLabel = (id: string) => {
    const c = categories.find((x) => x.id === id);
    if (!c) return '';
    const parent = categories.find((x) => x.id === c.parentId);
    return parent ? `${parent.name}, ${c.name.toLowerCase()}` : c.name;
  };

  const categoryText = (ids: string[]) => {
    const parents = new Set(
      categories.filter((c) => ids.includes(c.id) && c.parentId).map((c) => c.parentId),
    );
    const shown = ids
      .filter((id) => !parents.has(id))
      .map(catLabel)
      .filter(Boolean);
    return shown.length ? shown.join('; ') : 'Без раздела';
  };

  const customColumns: AdminColumn<SportDetails>[] = [
    {
      key: 'name',
      title: 'Направление',
      primary: true,
      render: (s) => (
        <div className={styles.person}>
          <SportIcon sport={s} size={20} variant="framed" />
          <div className={styles.personBody}>
            <span className={styles.nameLink}>{s.name}</span>
            <span className={styles.sub}>{categoryText(s.categoryIds)}</span>
          </div>
        </div>
      ),
    },
    {
      key: 'author',
      title: 'Кто добавил',
      width: 200,
      render: (s) => (
        <div className={styles.nameCell}>
          {s.createdBy ? (
            <Link to={`/profile/${s.createdBy.id}`}>{s.createdBy.name}</Link>
          ) : (
            <span className={styles.empty}>—</span>
          )}
          <span className={styles.sub}>{formatAgo(s.createdAt)}</span>
        </div>
      ),
    },
    {
      key: 'events',
      title: 'Событий',
      width: 110,
      align: 'right',
      sorter: (a, b) => a.eventsCount - b.eventsCount,
      render: (s) =>
        s.eventsCount ? (
          <Link to={`/admin/events?sport=${s.id}`} className={styles.num}>
            {s.eventsCount}
          </Link>
        ) : (
          <span className={styles.num}>0</span>
        ),
    },
    {
      key: 'similar',
      title: 'Похоже на',
      width: 200,
      render: (s) =>
        s.similar.length ? (
          s.similar.map((x) => x.name).join(', ')
        ) : (
          <span className={styles.empty}>Похожих нет</span>
        ),
    },
    {
      key: 'actions',
      title: 'Решение',
      width: 280,
      render: (s) => (
        <div className={styles.rowActions}>
          <Button
            size="sm"
            variant="secondary"
            icon={<PlusIcon size={18} aria-hidden />}
            onClick={() => setPromote(s)}
          >
            В каталог
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<ArrowsMergeIcon size={18} aria-hidden />}
            onClick={() => setMerge(s)}
          >
            Объединить
          </Button>
        </div>
      ),
    },
  ];

  const words = normalize(q).split(' ').filter(Boolean);
  const matchSport = (s: SportView) =>
    !words.length || words.every((w) => normalize(`${s.name} ${s.synonyms.join(' ')}`).includes(w));
  const top = categories.filter((c) => !c.parentId);

  return (
    <div className={[styles.page, styles.cards].join(' ')}>
      <PageHeader
        title="Направления"
        subtitle="Если нужного направления нет в каталоге, организатор вписывает своё при создании события. Такие направления можно перенести в каталог или объединить с похожими."
      />

      <Section title="Добавили пользователи" aside={customQuery.isLoading ? undefined : custom.length}>
        {sportsQuery.isError || customQuery.isError ? (
          <ErrorState
            title="Не удалось загрузить направления"
            onRetry={() => {
              void sportsQuery.refetch();
              void customQuery.refetch();
            }}
          />
        ) : (
          <AdminTable
            caption="Новые направления"
            rows={custom}
            rowKey={(s) => s.id}
            columns={customColumns}
            loading={sportsQuery.isLoading || (customIds.length > 0 && customQuery.isLoading)}
            empty={
              <EmptyState title="Новых направлений нет">
                Когда кто-то создаст событие с направлением, которого нет в каталоге, оно появится здесь.
              </EmptyState>
            }
          />
        )}
      </Section>

      <Section title="Каталог" aside={sports.filter((s) => s.kind === 'catalog').length}>
        <div className={styles.toolbar}>
          <Input
            className={styles.search}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            allowClear
            prefix={<MagnifyingGlassIcon size={20} aria-hidden />}
            placeholder="Название или другое слово, например «рюхи»"
            aria-label="Поиск по каталогу"
          />
        </div>
        {categoriesQuery.isError ? (
          <ErrorState title="Не удалось загрузить каталог" onRetry={() => void categoriesQuery.refetch()} />
        ) : categoriesQuery.isLoading ? (
          <SkeletonText lines={6} />
        ) : (
          <div className={styles.catalog}>
            {top.map((c) => {
              const children = categories.filter((x) => x.parentId === c.id);
              const childIds = new Set(children.flatMap((x) => x.sports.map((s) => s.id)));
              const own = c.sports.filter(
                (s) => s.kind === 'catalog' && !childIds.has(s.id) && matchSport(s),
              );
              const groups = children
                .map((x) => ({ cat: x, list: x.sports.filter((s) => s.kind === 'catalog' && matchSport(s)) }))
                .filter((g) => g.list.length);
              if (words.length && !own.length && !groups.length) return null;
              const total = own.length + groups.reduce((n, g) => n + g.list.length, 0);
              return (
                <section key={c.id} className={styles.category} aria-label={c.name}>
                  <header className={styles.categoryHead}>
                    <h3 className={[styles.categoryName, styles.inlineIcon].join(' ')}>
                      <SportIcon sport={{ name: c.name, icon: c.icon }} size={22} weight="regular" />
                      {c.name}
                    </h3>
                    <span className={styles.sub}>{count(total, WORDS.sport)}</span>
                  </header>
                  {own.map((s) => (
                    <SportRow key={s.id} sport={s} events={eventsBySport.get(s.id) ?? 0} />
                  ))}
                  {groups.map((g) => (
                    <div key={g.cat.id}>
                      <p className={[styles.sub, styles.subHead].join(' ')}>{g.cat.name}</p>
                      {g.list.map((s) => (
                        <SportRow key={s.id} sport={s} events={eventsBySport.get(s.id) ?? 0} />
                      ))}
                    </div>
                  ))}
                  {c.fields.length > 0 && (
                    <p className={styles.sub}>
                      Дополнительное поле у событий: {c.fields.map((f) => f.label).join(', ')}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </Section>

      <PromoteModal
        sport={promote}
        categories={categories}
        catLabel={catLabel}
        onClose={() => setPromote(null)}
      />
      <MergeModal sport={merge} sports={sports} onClose={() => setMerge(null)} />
    </div>
  );
}

function SportRow({ sport, events }: { sport: SportView; events: number }) {
  return (
    <div className={styles.sportRow}>
      <SportIcon sport={sport} size={20} variant="framed" />
      <div className={styles.personBody}>
        <span className={[styles.sportName, styles.inlineIcon].join(' ')}>
          {sport.name}
          {sport.popular && (
            <span className={styles.sub} title="Популярное: показывается первым">
              <StarIcon size={16} weight="fill" aria-label="Популярное" />
            </span>
          )}
        </span>
        {sport.synonyms.length > 0 && (
          <span className={styles.sub}>Ещё называют: {sport.synonyms.join(', ')}</span>
        )}
      </div>
      {events ? (
        <Link
          to={`/admin/events?sport=${sport.id}`}
          className={styles.num}
          aria-label={count(events, WORDS.event)}
        >
          {events}
        </Link>
      ) : (
        <span className={[styles.num, styles.empty].join(' ')} aria-label="Событий нет">
          0
        </span>
      )}
    </div>
  );
}

function PromoteModal({
  sport,
  categories,
  catLabel,
  onClose,
}: {
  sport: SportDetails | null;
  categories: CategoryView[];
  catLabel: (id: string) => string;
  onClose: () => void;
}) {
  const [form] = Form.useForm<{ categoryIds: string[]; icon: string | null; popular: boolean }>();
  const icon = Form.useWatch('icon', form);
  const { run, isPending } = useAction();

  const submit = async () => {
    if (!sport) return;
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    try {
      await run(
        API.promoteSport(sport.id),
        { categoryIds: v.categoryIds, icon: v.icon ?? null, popular: v.popular },
        { success: `${quoted(sport.name)} теперь в каталоге` },
      );
      onClose();
    } catch {
      /* ошибка показана, данные формы сохранены */
    }
  };

  return (
    <Modal
      open={Boolean(sport)}
      title={sport ? `Добавить ${quoted(sport.name)} в каталог` : ''}
      onCancel={onClose}
      width={640}
      destroyOnHidden
      footer={
        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Не сейчас
          </Button>
          <Button
            variant="primary"
            onClick={() => void submit()}
            loading={isPending}
            loadingText="Добавляем…"
          >
            Добавить в каталог
          </Button>
        </div>
      }
    >
      {sport && (
        <div className={styles.modalBody}>
          <div className={styles.consequences}>
            <p className={styles.consequencesTitle}>Что произойдёт</p>
            <ul>
              <li>Направление появится в каталоге в выбранных разделах, с иконкой вместо буквы.</li>
              <li>
                {sport.eventsCount
                  ? `${count(sport.eventsCount, WORDS.event)} останутся на месте, ничего не переносится.`
                  : 'Событий с этим направлением пока нет.'}
              </li>
            </ul>
          </div>
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{ categoryIds: sport.categoryIds, icon: null, popular: false }}
          >
            <Form.Item
              name="categoryIds"
              label="Раздел каталога"
              rules={[{ required: true, message: 'Выберите хотя бы один раздел' }]}
            >
              <Select
                mode="multiple"
                placeholder="Выберите раздел"
                options={categories.map((c) => ({ value: c.id, label: catLabel(c.id) }))}
                optionFilterProp="label"
              />
            </Form.Item>
            <Form.Item
              name="icon"
              label="Иконка"
              extra={icon ? undefined : 'Без иконки направление показывается первой буквой.'}
            >
              <IconPicker />
            </Form.Item>
            <Form.Item name="popular" valuePropName="checked">
              <Checkbox>Популярное: показывать в начале списка</Checkbox>
            </Form.Item>
          </Form>
        </div>
      )}
    </Modal>
  );
}

const ICON_LABEL: Record<string, string> = {
  SoccerBall: 'Футбольный мяч',
  Basketball: 'Баскетбольный мяч',
  Volleyball: 'Волейбольный мяч',
  TennisBall: 'Теннисный мяч',
  PingPong: 'Настольный теннис',
  Racquet: 'Ракетка',
  Hockey: 'Хоккей',
  PersonSimpleRun: 'Бег',
  PersonSimpleWalk: 'Ходьба',
  PersonSimpleBike: 'Велосипед',
  PersonSimpleSwim: 'Плавание',
  PersonSimpleHike: 'Поход',
  PersonSimpleSki: 'Лыжи',
  PersonSimpleTaiChi: 'Гимнастика',
  BoxingGlove: 'Единоборства',
  Strategy: 'Настольные игры',
  GameController: 'Игровая приставка',
  Sun: 'На улице',
  FlowerLotus: 'Йога',
  Barbell: 'Штанга',
  Snowflake: 'Зима',
  Heartbeat: 'Здоровье',
  HandHeart: 'Забота',
};

function IconPicker({ value, onChange }: { value?: string | null; onChange?: (v: string | null) => void }) {
  return (
    <div className={styles.iconGrid} role="radiogroup" aria-label="Иконка направления">
      {SPORT_ICON_NAMES.map((name) => {
        const Icon = SPORT_ICONS[name]!;
        const checked = value === name;
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={ICON_LABEL[name] ?? name}
            className={styles.iconOption}
            onClick={() => onChange?.(checked ? null : name)}
          >
            <Icon size={26} weight={checked ? 'fill' : 'regular'} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

function MergeModal({
  sport,
  sports,
  onClose,
}: {
  sport: SportDetails | null;
  sports: SportView[];
  onClose: () => void;
}) {
  const [form] = Form.useForm<{ into: string }>();
  const into = Form.useWatch('into', form);
  const target = sports.find((s) => s.id === into);
  const { run, isPending } = useAction();

  const submit = async () => {
    if (!sport) return;
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    try {
      await run(
        API.mergeSport(sport.id),
        { into: v.into },
        { success: `${quoted(sport.name)} объединено с «${target?.name ?? ''}»` },
      );
      onClose();
    } catch {
      /* ошибка показана, выбор сохранён */
    }
  };

  const candidates = sports.filter((s) => s.id !== sport?.id);
  const suggested = sport?.similar.find((s) => s.id !== sport.id)?.id;

  return (
    <Modal
      open={Boolean(sport)}
      title={sport ? `Объединить ${quoted(sport.name)} с другим направлением` : ''}
      onCancel={onClose}
      width={600}
      destroyOnHidden
      footer={
        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Не сейчас
          </Button>
          <Button
            variant="danger"
            onClick={() => void submit()}
            loading={isPending}
            loadingText="Объединяем…"
          >
            Объединить
          </Button>
        </div>
      }
    >
      {sport && (
        <div className={styles.modalBody}>
          <div className={styles.consequences}>
            <p className={styles.consequencesTitle}>Что произойдёт</p>
            <ul>
              <li>
                {sport.eventsCount
                  ? `${count(sport.eventsCount, WORDS.event)} перейдут в «${target?.name ?? 'выбранное направление'}».`
                  : 'Событий с этим направлением нет, переносить нечего.'}
              </li>
              <li>
                «{sport.name}» станет синонимом: поиск по этому слову найдёт «{target?.name ?? 'выбранное'}».
              </li>
              <li>Интересы людей, объявления и направления организаций тоже перейдут.</li>
              <li>Отменить объединение нельзя.</li>
            </ul>
          </div>
          <Form form={form} layout="vertical" requiredMark={false} initialValues={{ into: suggested }}>
            <Form.Item
              name="into"
              label="С каким направлением объединить"
              extra="Выберите основное название. Оно останется, а это станет его синонимом."
              rules={[{ required: true, message: 'Выберите направление' }]}
            >
              <Select
                showSearch
                optionFilterProp="label"
                placeholder="Начните вводить название"
                options={candidates.map((s) => ({
                  value: s.id,
                  label: s.kind === 'custom' ? `${s.name} (новое)` : s.name,
                }))}
              />
            </Form.Item>
          </Form>
        </div>
      )}
    </Modal>
  );
}
