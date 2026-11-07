import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  ProhibitIcon,
  QuestionIcon,
  WarningCircleIcon,
  XCircleIcon,
} from '@phosphor-icons/react';
import { Input, InputNumber, Select } from 'antd';
import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { AssistantMark, Button } from '@/components';
import { defaultCity } from '@/lib/cities';
import { formatAgo, formatEventDate } from '@/lib/dates';
import { COMMUNITY_API, useAction } from '@/lib/api';
import { formatRub } from '@/lib/money';
import { zonedParts, zonedToIso } from '@/lib/timezone';
import type { SportView } from '@/types/api';
import type { ImportDraft, ImportedPostView, ImportField } from '@/types/community';
import type { District } from '@/types/domain';

import styles from './imports.module.css';

const zone = () => defaultCity().timeZone;

interface Props {
  post: ImportedPostView;
  sports: SportView[];
  districts: District[];
}

export function StatusPill({ tone, icon, children }: { tone: 'ok' | 'wait' | 'off' | 'danger'; icon: ReactNode; children: ReactNode }) {
  return (
    <span className={[styles.pill, styles[tone]].join(' ')}>
      {icon}
      {children}
    </span>
  );
}

function priceText(price: ImportDraft['price'] | undefined): string {
  if (!price || price.kind === 'free') return 'Бесплатно';
  if (price.kind === 'fixed') return `${formatRub(price.amount)} с человека`;
  return `${formatRub(price.total)} на всех`;
}

export function ImportCard({ post, sports, districts }: Props) {
  const [editing, setEditing] = useState(false);
  const { run, isPending } = useAction<{ eventId: string }>();
  const [busy, setBusy] = useState<'publish' | 'reject' | 'restore' | null>(null);
  const d = post.draft;
  const draft = post.status === 'draft';

  const act = async (kind: 'publish' | 'reject' | 'restore') => {
    setBusy(kind);
    try {
      if (kind === 'publish')
        await run(COMMUNITY_API.publishImport(post.id), {}, { success: 'Встреча опубликована от имени сообщества' });
      if (kind === 'reject') await run(COMMUNITY_API.rejectImport(post.id), {}, { success: 'Пост отклонён' });
      if (kind === 'restore') await run(COMMUNITY_API.restoreImport(post.id), {}, { success: 'Пост вернулся в очередь' });
    } catch {
      if (kind === 'publish') setEditing(true);
    } finally {
      setBusy(null);
    }
  };

  const mark = (field: ImportField) => (post.assisted[field] ? <AssistantMark why={post.assisted[field]} /> : null);
  const missing = (text = 'не нашёл в посте') => <span className={styles.missing}>{text}</span>;

  return (
    <li className={[styles.card, (!post.meeting || !draft) && styles.cardMuted].filter(Boolean).join(' ')}>
      <div className={styles.post}>
        <div className={styles.source}>
          <a href={post.postUrl} target="_blank" rel="noreferrer noopener">
            {post.source.name}
            <ArrowSquareOutIcon size={16} aria-hidden />
            <span className="sr-only">(откроется в новой вкладке)</span>
          </a>
          {post.postedAt && <span>пост {formatAgo(post.postedAt)}</span>}
        </div>
        <blockquote className={styles.postText}>{post.text}</blockquote>
        <div className={styles.pills}>
          {post.status === 'published' && (
            <StatusPill tone="ok" icon={<CheckCircleIcon size={18} weight="bold" aria-hidden />}>
              Опубликовано
            </StatusPill>
          )}
          {post.status === 'rejected' && (
            <StatusPill tone="off" icon={<XCircleIcon size={18} weight="bold" aria-hidden />}>
              Отклонено: {post.rejectReason.toLowerCase()}
            </StatusPill>
          )}
          {draft && !post.meeting && (
            <StatusPill tone="off" icon={<QuestionIcon size={18} weight="bold" aria-hidden />}>
              Не похоже на встречу
            </StatusPill>
          )}
          {draft && post.stale && (
            <StatusPill tone="wait" icon={<WarningCircleIcon size={18} weight="bold" aria-hidden />}>
              Пост старше недели
            </StatusPill>
          )}
        </div>
      </div>

      <div className={styles.draft}>
        {editing && draft ? (
          <DraftEditor post={post} sports={sports} districts={districts} onClose={() => setEditing(false)} />
        ) : (
          <>
            <dl className={styles.fields}>
              <dt>Название</dt>
              <dd>
                {d.title || missing()}
                {mark('title')}
              </dd>
              <dt>Направление</dt>
              <dd>
                {post.sport?.name ?? (d.newSportName ? `${d.newSportName} (новое)` : missing())}
                {mark('sportId')}
              </dd>
              <dt>Когда</dt>
              <dd>
                {d.startsAt ? formatEventDate(d.startsAt) : missing()}
                {mark('startsAt')}
              </dd>
              <dt>Где</dt>
              <dd>
                {d.place?.address ? [d.place.address, post.districtName].filter(Boolean).join(', ') : missing()}
                {mark('place')}
              </dd>
              <dt>Стоимость</dt>
              <dd>
                {priceText(d.price)}
                {mark('price')}
              </dd>
              {d.capacity ? (
                <>
                  <dt>Мест</dt>
                  <dd>
                    {d.capacity}
                    {mark('capacity')}
                  </dd>
                </>
              ) : null}
            </dl>

            {draft && post.meeting && post.problems.length > 0 && (
              <div className={styles.problems} role="note">
                <WarningCircleIcon size={20} aria-hidden />
                <div>
                  <strong>Перед публикацией</strong>
                  <ul>
                    {post.problems.map((p) => (
                      <li key={p.field}>{p.text}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {post.status === 'published' && post.event && (
              <p className={styles.hint}>
                Встреча на сайте: <Link to={`/events/${post.event.id}`}>{post.event.title}</Link>
              </p>
            )}

            <div className={styles.actions}>
              {draft && post.meeting && post.problems.length === 0 && (
                <Button variant="primary" loading={busy === 'publish'} disabled={isPending} onClick={() => void act('publish')}>
                  Опубликовать от имени сообщества
                </Button>
              )}
              {draft && (
                <Button
                  variant={post.meeting && post.problems.length ? 'primary' : 'secondary'}
                  onClick={() => setEditing(true)}
                  disabled={isPending}
                >
                  {post.meeting ? 'Исправить поля' : 'Оформить как встречу'}
                </Button>
              )}
              {draft && (
                <Button
                  variant={post.meeting ? 'quiet' : 'secondary'}
                  icon={<ProhibitIcon size={20} aria-hidden />}
                  loading={busy === 'reject'}
                  disabled={isPending}
                  onClick={() => void act('reject')}
                >
                  Отклонить
                </Button>
              )}
              {post.status === 'rejected' && (
                <Button variant="secondary" loading={busy === 'restore'} onClick={() => void act('restore')}>
                  Вернуть в очередь
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </li>
  );
}

interface EditorValues {
  title: string;
  sportId: string | null;
  newSportName: string;
  date: string;
  time: string;
  address: string;
  districtId: string | null;
  free: boolean;
  amount: number | null;
  capacity: number | null;
  description: string;
}

function initialValues(post: ImportedPostView): EditorValues {
  const d = post.draft;
  const parts = d.startsAt ? zonedParts(d.startsAt, zone()) : null;
  return {
    title: d.title ?? '',
    sportId: d.sportId ?? null,
    newSportName: d.sportId ? '' : (d.newSportName ?? ''),
    date: parts?.date ?? '',
    time: parts?.time ?? '',
    address: d.place?.address ?? '',
    districtId: d.place?.districtId ?? null,
    free: !d.price || d.price.kind === 'free',
    amount: d.price?.kind === 'fixed' ? d.price.amount : null,
    capacity: d.capacity ?? null,
    description: d.description ?? post.text,
  };
}

function toPatch(v: EditorValues, post: ImportedPostView): Partial<ImportDraft> {
  const startsAt = v.date && v.time ? zonedToIso(v.date, v.time, zone()) : null;
  const sameAddress = v.address.trim() === (post.draft.place?.address ?? '');
  return {
    title: v.title.trim(),
    sportId: v.sportId ?? undefined,
    newSportName: v.sportId ? undefined : v.newSportName.trim() || undefined,
    startsAt: startsAt ?? undefined,
    place: {
      address: v.address.trim(),
      districtId: v.districtId,
      ...(sameAddress ? { lat: post.draft.place?.lat, lng: post.draft.place?.lng } : {}),
    },
    price: v.free || !v.amount ? { kind: 'free' } : { kind: 'fixed', amount: v.amount },
    capacity: v.capacity && v.capacity >= 2 ? v.capacity : null,
    description: v.description,
  };
}

function Field({
  label,
  error,
  children,
  wide,
  assisted,
  htmlFor,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  wide?: boolean;
  assisted?: string;
  htmlFor?: string;
}) {
  return (
    <div className={[styles.field, wide && styles.wide].filter(Boolean).join(' ')}>
      <label className={styles.fieldLabel} htmlFor={htmlFor}>
        {label}
        {assisted && <AssistantMark why={assisted} />}
      </label>
      {children}
      {error && <p className={styles.fieldError}>{error}</p>}
    </div>
  );
}

function DraftEditor({ post, sports, districts, onClose }: Props & { onClose: () => void }) {
  const [v, setV] = useState<EditorValues>(() => initialValues(post));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const { run } = useAction();
  const [busy, setBusy] = useState<'save' | 'publish' | null>(null);
  const id = useId();
  const set = (patch: Partial<EditorValues>) => setV((prev) => ({ ...prev, ...patch }));

  const submit = async (kind: 'save' | 'publish') => {
    setBusy(kind);
    setErrors({});
    try {
      if (kind === 'save')
        await run(COMMUNITY_API.saveImport(post.id), toPatch(v, post), { method: 'put', success: 'Правка сохранена' });
      else
        await run(COMMUNITY_API.publishImport(post.id), toPatch(v, post), {
          success: 'Встреча опубликована от имени сообщества',
        });
      onClose();
    } catch (error) {
      const fields = (error as { errors?: Record<string, string> }).errors;
      if (fields) setErrors(fields);
    } finally {
      setBusy(null);
    }
  };

  return (
    <form
      className={styles.editor}
      onSubmit={(e) => {
        e.preventDefault();
        void submit('publish');
      }}
      aria-label="Правка черновика встречи"
    >
      <Field label="Название" error={errors.title} wide assisted={post.assisted.title} htmlFor={`${id}-title`}>
        <Input id={`${id}-title`} value={v.title} maxLength={90} onChange={(e) => set({ title: e.target.value })} />
      </Field>
      <Field label="Направление" error={errors.sportId} assisted={post.assisted.sportId} htmlFor={`${id}-sport`}>
        <Select
          id={`${id}-sport`}
          showSearch
          allowClear
          placeholder="Выберите из списка"
          optionFilterProp="label"
          value={v.sportId ?? undefined}
          options={sports.map((s) => ({ value: s.id, label: s.name }))}
          onChange={(value?: string) => set({ sportId: value ?? null })}
        />
        {!v.sportId && v.newSportName && <span className={styles.hint}>Помощник предложил новое: {v.newSportName}</span>}
      </Field>
      <Field label="Район" htmlFor={`${id}-district`}>
        <Select
          id={`${id}-district`}
          allowClear
          placeholder="Не знаю"
          value={v.districtId ?? undefined}
          options={districts.map((x) => ({ value: x.id, label: x.name }))}
          onChange={(value?: string) => set({ districtId: value ?? null })}
        />
      </Field>
      <Field label="Дата и время (Красноярск)" error={errors.startsAt} wide assisted={post.assisted.startsAt} htmlFor={`${id}-date`}>
        <div className={styles.row}>
          <Input id={`${id}-date`} type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} aria-label="Дата" />
          <Input type="time" value={v.time} onChange={(e) => set({ time: e.target.value })} aria-label="Время начала" />
        </div>
      </Field>
      <Field label="Место" error={errors.place} wide assisted={post.assisted.place} htmlFor={`${id}-place`}>
        <Input
          id={`${id}-place`}
          value={v.address}
          placeholder="Например, ул. Карла Маркса, 114"
          onChange={(e) => set({ address: e.target.value })}
        />
      </Field>
      <Field label="Стоимость" assisted={post.assisted.price} htmlFor={`${id}-price`}>
        <div className={styles.row}>
          <Select
            id={`${id}-price`}
            value={v.free ? 'free' : 'fixed'}
            options={[
              { value: 'free', label: 'Бесплатно' },
              { value: 'fixed', label: 'Платно' },
            ]}
            onChange={(value: string) => set({ free: value === 'free' })}
          />
          {!v.free && (
            <InputNumber
              min={1}
              max={100000}
              value={v.amount}
              addonAfter="₽"
              aria-label="Цена с человека"
              onChange={(value) => set({ amount: typeof value === 'number' ? value : null })}
            />
          )}
        </div>
      </Field>
      <Field label="Сколько мест (необязательно)" assisted={post.assisted.capacity} htmlFor={`${id}-cap`}>
        <InputNumber
          id={`${id}-cap`}
          min={2}
          max={500}
          value={v.capacity}
          placeholder="Без ограничения"
          style={{ width: '100%' }}
          onChange={(value) => set({ capacity: typeof value === 'number' ? value : null })}
        />
      </Field>
      <Field label="Описание" wide htmlFor={`${id}-desc`}>
        <Input.TextArea
          id={`${id}-desc`}
          value={v.description}
          autoSize={{ minRows: 3, maxRows: 8 }}
          maxLength={2000}
          onChange={(e) => set({ description: e.target.value })}
        />
        <span className={styles.hint}>К описанию добавится ссылка на пост сообщества. Запись будет свободной.</span>
      </Field>
      <div className={[styles.actions, styles.wide].join(' ')}>
        <Button type="submit" variant="primary" loading={busy === 'publish'} disabled={busy !== null}>
          Опубликовать от имени сообщества
        </Button>
        <Button variant="secondary" loading={busy === 'save'} disabled={busy !== null} onClick={() => void submit('save')}>
          Сохранить правку
        </Button>
        <Button variant="quiet" disabled={busy !== null} onClick={onClose}>
          Отменить
        </Button>
      </div>
    </form>
  );
}
