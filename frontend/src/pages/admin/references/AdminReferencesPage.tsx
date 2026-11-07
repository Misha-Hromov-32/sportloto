import { useList } from '@refinedev/core';
import { Checkbox, Form, Input, InputNumber, Modal, Select, Tabs } from 'antd';
import { useState } from 'react';
import { Link } from 'react-router';

import { Button, EmptyState, ErrorState, PageHeader, SkeletonText, SPORT_ICON_NAMES } from '@/components';
import { useAction, useLiveGet } from '@/lib/api';
import { CITIES, loadCities } from '@/lib/cities';
import { normalize } from '@/lib/text';
import type { CategoryView, SportView } from '@/types/api';

import { AdminTable, type AdminColumn } from '../parts/AdminTable';
import styles from '../parts/admin.module.css';

interface Usage {
  kind: string;
  count: number;
  label: string;
}
interface CityRow {
  id: string;
  name: string;
  nameIn: string;
  region: string;
  timeZone: string;
  center: { lat: number; lng: number };
  radiusKm: number;
  isDefault: boolean;
  hidden: boolean;
  usage: Usage[];
}
interface DistrictRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  cityId: string | null;
  usage: Usage[];
}
interface RuleRow {
  id: string;
  number: number;
  title: string;
  text: string;
  example: string | null;
  hidden: boolean;
  usage: Usage[];
}

const ZONES = [
  ['Europe/Kaliningrad', 'Калининград (МСК−1)'],
  ['Europe/Moscow', 'Москва (МСК)'],
  ['Europe/Samara', 'Самара (МСК+1)'],
  ['Asia/Yekaterinburg', 'Екатеринбург (МСК+2)'],
  ['Asia/Omsk', 'Омск (МСК+3)'],
  ['Asia/Novosibirsk', 'Новосибирск (МСК+4)'],
  ['Asia/Krasnoyarsk', 'Красноярск (МСК+4)'],
  ['Asia/Irkutsk', 'Иркутск (МСК+5)'],
  ['Asia/Yakutsk', 'Якутск (МСК+6)'],
  ['Asia/Vladivostok', 'Владивосток (МСК+7)'],
  ['Asia/Magadan', 'Магадан (МСК+8)'],
  ['Asia/Kamchatka', 'Камчатка (МСК+9)'],
].map(([value, label]) => ({ value, label }));

const usageText = (u: Usage[]) => (u.length ? u.map((x) => x.label).join(', ') : 'Нигде не указан');

/** Ошибка «используется»: сервер прислал понятный текст, показываем его в окне, а не всплывашкой. */
function confirmDanger(title: string, content: string, onOk: () => Promise<unknown>) {
  Modal.confirm({ title, content, okText: 'Да', cancelText: 'Отмена', okButtonProps: { danger: true }, onOk });
}

export default function AdminReferencesPage() {
  return (
    <div className={styles.page}>
      <PageHeader
        title="Справочники"
        subtitle="Города, районы, виды спорта и правила площадки. Что используется в записях, нельзя удалить, но можно скрыть: в выборе пропадёт, старые записи останутся как были."
      />
      <Tabs
        items={[
          { key: 'cities', label: 'Города', children: <CitiesTab /> },
          { key: 'districts', label: 'Районы', children: <DistrictsTab /> },
          { key: 'sports', label: 'Виды спорта', children: <SportsTab /> },
          { key: 'rules', label: 'Правила площадки', children: <RulesTab /> },
        ]}
      />
    </div>
  );
}

// ---------- Города ----------

function CitiesTab() {
  const { data, isLoading, isError, refetch } = useLiveGet<CityRow[]>('/admin/cities', ['cities', 'events']);
  const { run } = useAction();
  const [edit, setEdit] = useState<CityRow | 'new' | null>(null);
  const rows = data ?? [];
  const after = async (p: Promise<unknown>) => {
    await p;
    await refetch();
    void loadCities(true);
  };

  const columns: AdminColumn<CityRow>[] = [
    {
      key: 'name',
      title: 'Город',
      primary: true,
      render: (c) => (
        <div className={styles.personBody}>
          <span className={styles.nameLink}>
            {c.name}
            {c.isDefault ? ' · по умолчанию' : ''}
            {c.hidden ? ' · скрыт' : ''}
          </span>
          <span className={styles.sub}>{c.region}</span>
        </div>
      ),
    },
    {
      key: 'zone',
      title: 'Пояс и граница',
      width: 220,
      render: (c) => (
        <span className={styles.sub}>
          {ZONES.find((z) => z.value === c.timeZone)?.label ?? c.timeZone}, радиус {c.radiusKm} км
        </span>
      ),
    },
    { key: 'usage', title: 'Что есть в городе', width: 240, render: (c) => <span className={styles.sub}>{usageText(c.usage)}</span> },
    {
      key: 'actions',
      title: 'Действия',
      width: 300,
      render: (c) => (
        <div className={styles.rowActions}>
          <Button size="sm" variant="secondary" onClick={() => setEdit(c)}>
            Изменить
          </Button>
          {!c.isDefault && !c.hidden && (
            <Button size="sm" variant="secondary" onClick={() => void after(run(`/admin/cities/${c.id}`, { isDefault: true }, { method: 'put', success: `${c.name} теперь город по умолчанию` }))}>
              По умолчанию
            </Button>
          )}
          {!c.isDefault && (
            <Button size="sm" variant="secondary" onClick={() => void after(run(`/admin/cities/${c.id}`, { hidden: !c.hidden }, { method: 'put', success: c.hidden ? 'Город снова в выборе' : 'Город скрыт из выбора' }))}>
              {c.hidden ? 'Показать' : 'Скрыть'}
            </Button>
          )}
          {!c.isDefault && !c.usage.length && (
            <Button size="sm" variant="danger" onClick={() => confirmDanger(`Удалить город «${c.name}»?`, 'В городе нет встреч и районов. Удаление нельзя отменить.', () => after(run(`/admin/cities/${c.id}`, {}, { method: 'delete', success: 'Город удалён' })))}>
              Удалить
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (isError) return <ErrorState title="Не удалось загрузить города" onRetry={() => void refetch()} />;
  return (
    <>
      <div className={styles.toolbar}>
        <Button variant="primary" onClick={() => setEdit('new')}>
          Добавить город
        </Button>
      </div>
      <AdminTable caption="Города" rows={rows} rowKey={(c) => c.id} columns={columns} loading={isLoading} empty={<EmptyState title="Городов нет" />} />
      <CityModal value={edit} onClose={() => setEdit(null)} onSaved={() => void after(Promise.resolve())} />
    </>
  );
}

interface CityValues {
  name: string;
  nameIn: string;
  region: string;
  timeZone: string;
  lat: number;
  lng: number;
  radiusKm: number;
}

function CityModal({ value, onClose, onSaved }: { value: CityRow | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm<CityValues>();
  const { run, isPending } = useAction();
  const [warn, setWarn] = useState<string | null>(null);
  const city = value && value !== 'new' ? value : null;

  const save = async (confirm = false) => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const body = {
      name: v.name,
      nameIn: v.nameIn,
      region: v.region ?? '',
      timeZone: v.timeZone,
      center: { lat: v.lat, lng: v.lng },
      radiusKm: v.radiusKm,
      confirm,
    };
    try {
      await run(city ? `/admin/cities/${city.id}` : '/admin/cities', body, {
        method: city ? 'put' : 'post',
        silent: true,
        success: city ? 'Город сохранён' : `Город «${v.name}» добавлен`,
      });
      setWarn(null);
      onSaved();
      onClose();
    } catch (e) {
      const err = e as { code?: string; message?: string };
      setWarn(err.message ?? 'Не получилось сохранить');
      if (err.code !== 'outside_city') setWarn(err.message ?? 'Не получилось сохранить');
    }
  };

  return (
    <Modal
      open={Boolean(value)}
      title={city ? `Город «${city.name}»` : 'Новый город'}
      onCancel={() => {
        setWarn(null);
        onClose();
      }}
      destroyOnHidden
      footer={
        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          {warn?.includes('за границей') && (
            <Button variant="danger" onClick={() => void save(true)} loading={isPending}>
              Всё равно сохранить
            </Button>
          )}
          <Button variant="primary" onClick={() => void save()} loading={isPending}>
            Сохранить
          </Button>
        </div>
      }
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={
          city
            ? { ...city, lat: city.center.lat, lng: city.center.lng }
            : { timeZone: 'Europe/Moscow', radiusKm: 35 }
        }
      >
        <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Укажите название' }]}>
          <Input placeholder="Например, Тула" />
        </Form.Item>
        <Form.Item name="nameIn" label="Как сказать «в городе»" extra="Без предлога: «Туле», «Москве»." rules={[{ required: true, message: 'Заполните поле' }]}>
          <Input placeholder="Туле" />
        </Form.Item>
        <Form.Item name="region" label="Регион">
          <Input placeholder="Тульская область" />
        </Form.Item>
        <Form.Item name="timeZone" label="Часовой пояс" rules={[{ required: true, message: 'Выберите пояс' }]}>
          <Select options={ZONES} />
        </Form.Item>
        <Form.Item label="Центр города" extra="Широта и долгота центра. Их можно взять на любой карте.">
          <div className={styles.rowActions}>
            <Form.Item name="lat" noStyle rules={[{ required: true, message: 'Укажите широту' }]}>
              <InputNumber placeholder="Широта, 54.19" step={0.001} style={{ width: 170 }} />
            </Form.Item>
            <Form.Item name="lng" noStyle rules={[{ required: true, message: 'Укажите долготу' }]}>
              <InputNumber placeholder="Долгота, 37.62" step={0.001} style={{ width: 170 }} />
            </Form.Item>
          </div>
        </Form.Item>
        <Form.Item name="radiusKm" label="Граница города, км от центра" extra="Встречи и районы внутри круга относятся к городу.">
          <InputNumber min={3} max={150} />
        </Form.Item>
      </Form>
      {warn && (
        <p role="alert" className={styles.sub}>
          {warn}
        </p>
      )}
    </Modal>
  );
}

// ---------- Районы ----------

function DistrictsTab() {
  const [cityId, setCityId] = useState(CITIES[0]?.id ?? 'krasnoyarsk');
  const { data, isLoading, isError, refetch } = useLiveGet<DistrictRow[]>(`/admin/districts?cityId=${cityId}`, ['districts']);
  const { run } = useAction();
  const [edit, setEdit] = useState<DistrictRow | 'new' | null>(null);
  const [merge, setMerge] = useState<DistrictRow | null>(null);
  const rows = data ?? [];
  const after = async (p: Promise<unknown>) => {
    await p.catch(() => undefined);
    await refetch();
  };

  const columns: AdminColumn<DistrictRow>[] = [
    { key: 'name', title: 'Район', primary: true, render: (d) => <span className={styles.nameLink}>{d.name}</span> },
    { key: 'usage', title: 'Где указан', width: 320, render: (d) => <span className={styles.sub}>{usageText(d.usage)}</span> },
    {
      key: 'actions',
      title: 'Действия',
      width: 320,
      render: (d) => (
        <div className={styles.rowActions}>
          <Button size="sm" variant="secondary" onClick={() => setEdit(d)}>
            Изменить
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMerge(d)}>
            Объединить
          </Button>
          {!d.usage.length && (
            <Button size="sm" variant="danger" onClick={() => confirmDanger(`Удалить район «${d.name}»?`, 'Район нигде не указан. Удаление нельзя отменить.', () => after(run(`/admin/districts/${d.id}`, {}, { method: 'delete', success: 'Район удалён' })))}>
              Удалить
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (isError) return <ErrorState title="Не удалось загрузить районы" onRetry={() => void refetch()} />;
  return (
    <>
      <div className={styles.toolbar}>
        <Select value={cityId} onChange={setCityId} options={CITIES.map((c) => ({ value: c.id, label: c.name }))} aria-label="Город" style={{ minWidth: 200 }} />
        <Button variant="primary" onClick={() => setEdit('new')}>
          Добавить район
        </Button>
      </div>
      <AdminTable caption="Районы" rows={rows} rowKey={(d) => d.id} columns={columns} loading={isLoading} empty={<EmptyState title="В этом городе районов нет" />} />
      <DistrictModal value={edit} cityId={cityId} onClose={() => setEdit(null)} onSaved={() => void refetch()} />
      <Modal
        open={Boolean(merge)}
        title={merge ? `Объединить «${merge.name}» с другим районом` : ''}
        onCancel={() => setMerge(null)}
        destroyOnHidden
        footer={null}
      >
        {merge && (
          <MergeDistrict
            district={merge}
            options={rows.filter((d) => d.id !== merge.id)}
            onDone={() => {
              setMerge(null);
              void refetch();
            }}
          />
        )}
      </Modal>
    </>
  );
}

function MergeDistrict({ district, options, onDone }: { district: DistrictRow; options: DistrictRow[]; onDone: () => void }) {
  const [into, setInto] = useState<string | undefined>();
  const { run, isPending } = useAction();
  return (
    <div className={styles.modalBody}>
      <p>Все встречи, площадки, люди и объявления района «{district.name}» перейдут в выбранный район. Сам район исчезнет. Отменить нельзя.</p>
      <Select value={into} onChange={setInto} placeholder="Выберите район" options={options.map((d) => ({ value: d.id, label: d.name }))} style={{ width: '100%' }} />
      <div className={styles.modalFooter}>
        <Button
          variant="danger"
          disabled={!into}
          loading={isPending}
          onClick={() =>
            void run(`/admin/districts/${district.id}/merge`, { into }, { success: 'Районы объединены' }).then(onDone).catch(() => undefined)
          }
        >
          Объединить
        </Button>
      </div>
    </div>
  );
}

function DistrictModal({ value, cityId, onClose, onSaved }: { value: DistrictRow | 'new' | null; cityId: string; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm<{ name: string; lat: number; lng: number }>();
  const { run, isPending } = useAction();
  const district = value && value !== 'new' ? value : null;
  const city = CITIES.find((c) => c.id === cityId);
  const save = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    try {
      await run(district ? `/admin/districts/${district.id}` : '/admin/districts', { ...v, cityId }, { method: district ? 'put' : 'post', success: 'Район сохранён' });
      onSaved();
      onClose();
    } catch {
      /* текст ошибки показан */
    }
  };
  return (
    <Modal
      open={Boolean(value)}
      title={district ? `Район «${district.name}»` : `Новый район${city ? `, ${city.name}` : ''}`}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={isPending}>
            Сохранить
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={district ?? { lat: city?.center.lat, lng: city?.center.lng }}>
        <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Укажите название' }]}>
          <Input />
        </Form.Item>
        <Form.Item label="Точка района" extra="Широта и долгота середины района, внутри границы города.">
          <div className={styles.rowActions}>
            <Form.Item name="lat" noStyle rules={[{ required: true, message: 'Укажите широту' }]}>
              <InputNumber step={0.001} style={{ width: 170 }} aria-label="Широта" />
            </Form.Item>
            <Form.Item name="lng" noStyle rules={[{ required: true, message: 'Укажите долготу' }]}>
              <InputNumber step={0.001} style={{ width: 170 }} aria-label="Долгота" />
            </Form.Item>
          </div>
        </Form.Item>
      </Form>
    </Modal>
  );
}

// ---------- Виды спорта ----------

function SportsTab() {
  const { result, query } = useList<SportView>({
    resource: 'sports',
    filters: [{ field: 'includeHidden', operator: 'eq', value: true }],
    pagination: { mode: 'off' },
  });
  const { result: cats } = useList<CategoryView>({
    resource: 'categories',
    filters: [{ field: 'includeHidden', operator: 'eq', value: true }],
    pagination: { mode: 'off' },
  });
  const { run } = useAction();
  const [q, setQ] = useState('');
  const [edit, setEdit] = useState<SportView | 'new' | null>(null);
  const categories = cats?.data ?? [];
  const words = normalize(q).split(' ').filter(Boolean);
  const rows = (result?.data ?? []).filter(
    (s) => s.kind === 'catalog' && words.every((w) => normalize(`${s.name} ${s.synonyms.join(' ')}`).includes(w)),
  );
  const refetch = () => void query.refetch();

  const columns: AdminColumn<SportView>[] = [
    {
      key: 'name',
      title: 'Вид спорта',
      primary: true,
      render: (s) => (
        <div className={styles.personBody}>
          <span className={styles.nameLink}>
            {s.name}
            {s.hidden ? ' · скрыт' : ''}
            {s.popular ? ' · популярное' : ''}
          </span>
          {s.synonyms.length > 0 && <span className={styles.sub}>Ещё называют: {s.synonyms.join(', ')}</span>}
        </div>
      ),
    },
    {
      key: 'cats',
      title: 'Разделы',
      width: 240,
      render: (s) => <span className={styles.sub}>{s.categoryIds.map((id) => categories.find((c) => c.id === id)?.name).filter(Boolean).join(', ') || 'Без раздела'}</span>,
    },
    {
      key: 'actions',
      title: 'Действия',
      width: 240,
      render: (s) => (
        <div className={styles.rowActions}>
          <Button size="sm" variant="secondary" onClick={() => setEdit(s)}>
            Изменить
          </Button>
          <Button size="sm" variant="secondary" onClick={() => void run(`/admin/sports/${s.id}`, { hidden: !s.hidden }, { method: 'put', success: s.hidden ? 'Снова в выборе' : 'Скрыто из выбора' }).then(refetch).catch(() => undefined)}>
            {s.hidden ? 'Показать' : 'Скрыть'}
          </Button>
        </div>
      ),
    },
  ];

  if (query.isError) return <ErrorState title="Не удалось загрузить каталог" onRetry={refetch} />;
  return (
    <>
      <p className={styles.sub}>
        Объединить похожие и перенести в каталог те, что добавили пользователи, можно в разделе <Link to="/admin/sports">«Направления»</Link>.
      </p>
      <div className={styles.toolbar}>
        <Input className={styles.search} value={q} onChange={(e) => setQ(e.target.value)} allowClear placeholder="Название или другое слово" aria-label="Поиск по каталогу" />
        <Button variant="primary" onClick={() => setEdit('new')}>
          Добавить вид спорта
        </Button>
      </div>
      {query.isLoading ? (
        <SkeletonText lines={6} />
      ) : (
        <AdminTable caption="Каталог" rows={rows} rowKey={(s) => s.id} columns={columns} empty={<EmptyState title="Ничего не нашли" />} />
      )}
      <SportModal value={edit} categories={categories} onClose={() => setEdit(null)} onSaved={refetch} />
      <CategoriesBlock categories={categories} />
    </>
  );
}

function SportModal({ value, categories, onClose, onSaved }: { value: SportView | 'new' | null; categories: CategoryView[]; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm<{ name: string; synonyms: string[]; icon?: string; categoryIds: string[]; popular: boolean }>();
  const { run, isPending } = useAction();
  const sport = value && value !== 'new' ? value : null;
  const save = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    try {
      await run(sport ? `/admin/sports/${sport.id}` : '/admin/sports', { ...v, icon: v.icon ?? null }, { method: sport ? 'put' : 'post', success: 'Сохранено' });
      onSaved();
      onClose();
    } catch {
      /* текст ошибки показан */
    }
  };
  return (
    <Modal
      open={Boolean(value)}
      title={sport ? `«${sport.name}»` : 'Новый вид спорта'}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={isPending}>
            Сохранить
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={sport ?? { synonyms: [], categoryIds: [], popular: false }}>
        <Form.Item name="name" label="Название" rules={[{ required: true, message: 'Укажите название' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="synonyms" label="Другие названия для поиска" extra="Слова, которыми люди называют этот спорт. Введите слово и нажмите Enter.">
          <Select mode="tags" open={false} tokenSeparators={[',']} />
        </Form.Item>
        <Form.Item name="categoryIds" label="Разделы" rules={[{ required: true, message: 'Выберите хотя бы один раздел' }]}>
          <Select mode="multiple" optionFilterProp="label" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        </Form.Item>
        <Form.Item name="icon" label="Иконка">
          <Select allowClear options={SPORT_ICON_NAMES.map((n) => ({ value: n, label: n }))} />
        </Form.Item>
        <Form.Item name="popular" valuePropName="checked">
          <Checkbox>Популярное: показывать в начале списка</Checkbox>
        </Form.Item>
      </Form>
    </Modal>
  );
}

function CategoriesBlock({ categories }: { categories: CategoryView[] }) {
  const { run, isPending } = useAction();
  const [name, setName] = useState('');
  return (
    <section aria-label="Разделы каталога" className={styles.modalBody}>
      <h3>Разделы каталога</h3>
      <ul>
        {categories.map((c) => (
          <li key={c.id} className={styles.rowActions}>
            <span>
              {c.parentId ? '— ' : ''}
              {c.name}
              {(c as CategoryView & { hidden?: boolean }).hidden ? ' · скрыт' : ''}
            </span>
            <Button size="sm" variant="secondary" onClick={() => void run(`/admin/categories/${c.id}`, { hidden: !(c as CategoryView & { hidden?: boolean }).hidden }, { method: 'put', success: 'Сохранено' }).catch(() => undefined)}>
              {(c as CategoryView & { hidden?: boolean }).hidden ? 'Показать' : 'Скрыть'}
            </Button>
          </li>
        ))}
      </ul>
      <div className={styles.toolbar}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Новый раздел" aria-label="Название нового раздела" />
        <Button variant="secondary" loading={isPending} disabled={name.trim().length < 2} onClick={() => void run('/admin/categories', { name }, { success: 'Раздел добавлен' }).then(() => setName('')).catch(() => undefined)}>
          Добавить раздел
        </Button>
      </div>
    </section>
  );
}

// ---------- Правила ----------

function RulesTab() {
  const { data, isLoading, isError, refetch } = useLiveGet<RuleRow[]>('/admin/rules', ['rules']);
  const { run } = useAction();
  const [edit, setEdit] = useState<RuleRow | 'new' | null>(null);
  const rows = data ?? [];
  const after = (p: Promise<unknown>) => void p.then(() => refetch()).catch(() => undefined);

  const columns: AdminColumn<RuleRow>[] = [
    {
      key: 'title',
      title: 'Правило',
      primary: true,
      render: (r) => (
        <div className={styles.personBody}>
          <span className={styles.nameLink}>
            {r.number}. {r.title}
            {r.hidden ? ' · скрыто' : ''}
          </span>
          <span className={styles.sub}>{r.text}</span>
          {r.example && <span className={styles.sub}>Например: {r.example}</span>}
        </div>
      ),
    },
    { key: 'usage', title: 'Ссылались', width: 200, render: (r) => <span className={styles.sub}>{r.usage.length ? r.usage.map((u) => u.label).join(', ') : 'Нет'}</span> },
    {
      key: 'actions',
      title: 'Действия',
      width: 340,
      render: (r) => (
        <div className={styles.rowActions}>
          <Button size="sm" variant="secondary" aria-label="Выше" onClick={() => after(run(`/admin/rules/${r.id}/move`, { direction: 'up' }))}>
            ↑
          </Button>
          <Button size="sm" variant="secondary" aria-label="Ниже" onClick={() => after(run(`/admin/rules/${r.id}/move`, { direction: 'down' }))}>
            ↓
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setEdit(r)}>
            Изменить
          </Button>
          <Button size="sm" variant="secondary" onClick={() => after(run(`/admin/rules/${r.id}`, { hidden: !r.hidden }, { method: 'put', success: r.hidden ? 'Правило снова видно' : 'Правило скрыто' }))}>
            {r.hidden ? 'Показать' : 'Скрыть'}
          </Button>
          {!r.usage.length && (
            <Button size="sm" variant="danger" onClick={() => confirmDanger(`Удалить правило «${r.title}»?`, 'Удаление нельзя отменить.', () => run(`/admin/rules/${r.id}`, {}, { method: 'delete', success: 'Правило удалено' }).then(() => refetch()))}>
              Удалить
            </Button>
          )}
        </div>
      ),
    },
  ];

  if (isError) return <ErrorState title="Не удалось загрузить правила" onRetry={() => void refetch()} />;
  return (
    <>
      <div className={styles.toolbar}>
        <Button variant="primary" onClick={() => setEdit('new')}>
          Добавить правило
        </Button>
      </div>
      <AdminTable caption="Правила площадки" rows={rows} rowKey={(r) => r.id} columns={columns} loading={isLoading} empty={<EmptyState title="Правил нет" />} />
      <RuleModal value={edit} onClose={() => setEdit(null)} onSaved={() => void refetch()} />
    </>
  );
}

function RuleModal({ value, onClose, onSaved }: { value: RuleRow | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const [form] = Form.useForm<{ title: string; text: string; example?: string }>();
  const { run, isPending } = useAction();
  const rule = value && value !== 'new' ? value : null;
  const save = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    try {
      await run(rule ? `/admin/rules/${rule.id}` : '/admin/rules', { ...v, example: v.example ?? '' }, { method: rule ? 'put' : 'post', success: 'Правило сохранено' });
      onSaved();
      onClose();
    } catch {
      /* текст ошибки показан */
    }
  };
  return (
    <Modal
      open={Boolean(value)}
      title={rule ? `Правило ${rule.number}` : 'Новое правило'}
      onCancel={onClose}
      destroyOnHidden
      width={640}
      footer={
        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose} disabled={isPending}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => void save()} loading={isPending}>
            Сохранить
          </Button>
        </div>
      }
    >
      <Form form={form} layout="vertical" requiredMark={false} initialValues={rule ?? {}}>
        <Form.Item name="title" label="Коротко" rules={[{ required: true, message: 'Напишите название' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="text" label="Текст правила" rules={[{ required: true, message: 'Напишите текст' }]}>
          <Input.TextArea rows={4} />
        </Form.Item>
        <Form.Item name="example" label="Пример" extra="Необязательно. Что нарушает правило или как поступить правильно.">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
