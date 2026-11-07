import {
  CaretDownIcon,
  CaretUpIcon,
  CheckCircleIcon,
  EyeSlashIcon,
  MagnifyingGlassIcon,
  RobotIcon,
} from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { Checkbox, Input, Segmented } from 'antd';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';

import { Button, EmptyState, ErrorState, PageHeader, SkeletonBlock, SkeletonText } from '@/components';
import { formatAgo } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { normalize, truncate } from '@/lib/text';
import type { MessageView } from '@/types/api';
import type { PlatformRule } from '@/types/domain';

import styles from './parts/admin.module.css';
import { ReportsPanel } from './reports/ReportsPanel'; // С16
import { useSearchField, useUrlParams } from './parts/hooks';
import { flagTitle } from './parts/labels';
import { useMessageModeration } from './parts/useMessageModeration';

type Tab = 'flagged' | 'hidden' | 'all';

const isFlagged = (m: MessageView) => m.aiFlag !== 'none' && m.status === 'visible';

export default function AdminMessagesPage() {
  const [params, setParams] = useUrlParams({ tab: 'flagged', q: '' });
  const [text, setText] = useSearchField(params.q, (q) => setParams({ q }));
  const tab = (['flagged', 'hidden', 'all'].includes(params.tab) ? params.tab : 'flagged') as Tab;
  const [selected, setSelected] = useState<string[]>([]);

  const { result, query } = useList<MessageView>({
    resource: 'messages',
    filters: [{ field: 'scope', operator: 'eq', value: 'all' }],
    pagination: { mode: 'off' },
  });
  const { result: rulesRes } = useList<PlatformRule>({ resource: 'rules', pagination: { mode: 'off' } });
  const moderation = useMessageModeration(rulesRes?.data ?? [], () => setSelected([]));

  const all = useMemo(() => (result?.data ?? []).filter((m) => m.status !== 'deleted'), [result]);
  const tabCounts = {
    flagged: all.filter(isFlagged).length,
    hidden: all.filter((m) => m.status === 'hidden').length,
    all: all.length,
  };

  const rows = useMemo(() => {
    const words = normalize(params.q).split(' ').filter(Boolean);
    return all.filter((m) => {
      if (tab === 'flagged' && !isFlagged(m)) return false;
      if (tab === 'hidden' && m.status !== 'hidden') return false;
      if (words.length) {
        const hay = normalize(`${m.text ?? ''} ${m.author?.name ?? ''} ${m.event.title}`);
        if (!words.every((w) => hay.includes(w))) return false;
      }
      return true;
    });
  }, [all, tab, params.q]);

  const chosen = rows.filter((m) => selected.includes(m.id));
  const allChosen = rows.length > 0 && chosen.length === rows.length;
  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => (on ? [...new Set([...prev, id])] : prev.filter((x) => x !== id)));

  const switchTab = (next: Tab) => {
    setSelected([]);
    setParams({ tab: next });
  };

  const visibleChosen = chosen.filter((m) => m.status === 'visible');
  const flaggedChosen = chosen.filter(isFlagged);
  const hiddenChosen = chosen.filter((m) => m.status === 'hidden');

  return (
    <div className={styles.page}>
      <PageHeader
        title="Обсуждения"
        subtitle="Здесь сообщения с пометками о возможном спаме или оскорблениях, а также сообщения, скрытые модератором. Пометка помощника требует проверки и не скрывает сообщение автоматически."
      />

      {/* С16: жалобы участников */}
      <ReportsPanel target="message" />

      <div className={styles.toolbar}>
        <Segmented<Tab>
          value={tab}
          onChange={switchTab}
          options={[
            { value: 'flagged', label: `С пометкой помощника (${tabCounts.flagged})` },
            { value: 'hidden', label: `Скрытые (${tabCounts.hidden})` },
            { value: 'all', label: 'Все' },
          ]}
          aria-label="Какие сообщения показать"
        />
        <Input
          className={styles.search}
          value={text}
          onChange={(e) => setText(e.target.value)}
          allowClear
          prefix={<MagnifyingGlassIcon size={20} aria-hidden />}
          placeholder="Текст, автор или событие"
          aria-label="Поиск сообщений"
        />
      </div>

      {query.isError ? (
        <ErrorState title="Не удалось загрузить сообщения" onRetry={() => void query.refetch()} />
      ) : query.isLoading ? (
        <div className={styles.queue} aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className={styles.queueItem}>
              <SkeletonBlock width={20} height={20} />
              <div className={styles.queueBody}>
                <SkeletonBlock width="40%" height={16} />
                <SkeletonBlock height={64} />
              </div>
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          {...(params.q ? {} : { icon: <CheckCircleIcon size={28} aria-hidden /> })}
          title={
            params.q
              ? 'Ничего не нашлось'
              : tab === 'flagged'
                ? 'Очередь пуста'
                : tab === 'hidden'
                  ? 'Скрытых сообщений нет'
                  : 'Сообщений пока нет'
          }
          actions={
            params.q ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setText('');
                  setParams({ q: '' });
                }}
              >
                Очистить поиск
              </Button>
            ) : undefined
          }
        >
          {params.q
            ? 'Попробуйте другое слово.'
            : tab === 'flagged'
              ? 'Новых пометок нет. Когда помощник что-то заметит, сообщение появится здесь.'
              : 'Когда вы скроете сообщение, его можно будет вернуть отсюда.'}
        </EmptyState>
      ) : (
        <>
          <div className={styles.bulkBar}>
            <Checkbox
              className={styles.check}
              checked={allChosen}
              indeterminate={chosen.length > 0 && !allChosen}
              onChange={(e) => setSelected(e.target.checked ? rows.map((m) => m.id) : [])}
            >
              {chosen.length ? `Выбрано: ${chosen.length}` : `Выбрать все (${rows.length})`}
            </Checkbox>
            {visibleChosen.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                icon={<EyeSlashIcon size={18} aria-hidden />}
                onClick={() => moderation.askHide(visibleChosen)}
              >
                Скрыть выбранные ({visibleChosen.length})
              </Button>
            )}
            {flaggedChosen.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => void moderation.keep(flaggedChosen)}>
                Оставить выбранные ({flaggedChosen.length})
              </Button>
            )}
            {hiddenChosen.length > 0 && (
              <Button size="sm" variant="secondary" onClick={() => void moderation.restore(hiddenChosen)}>
                Вернуть выбранные ({hiddenChosen.length})
              </Button>
            )}
          </div>

          <ul className={styles.queue} aria-label="Сообщения">
            {rows.map((m) => (
              <QueueItem
                key={m.id}
                message={m}
                checked={selected.includes(m.id)}
                busy={moderation.busyIds.includes(m.id)}
                onCheck={(on) => toggle(m.id, on)}
                onHide={() => moderation.askHide([m])}
                onKeep={() => void moderation.keep([m])}
                onRestore={() => void moderation.restore([m])}
              />
            ))}
          </ul>
        </>
      )}
      {moderation.modal}
    </div>
  );
}

function QueueItem({
  message: m,
  checked,
  busy,
  onCheck,
  onHide,
  onKeep,
  onRestore,
}: {
  message: MessageView;
  checked: boolean;
  busy: boolean;
  onCheck: (on: boolean) => void;
  onHide: () => void;
  onKeep: () => void;
  onRestore: () => void;
}) {
  const [showContext, setShowContext] = useState(false);
  const author = m.author?.orgName ?? m.author?.name ?? 'Участник';
  return (
    <li className={styles.queueItem}>
      <span className={styles.queueCheck}>
        <Checkbox
          checked={checked}
          onChange={(e) => onCheck(e.target.checked)}
          aria-label={`Выбрать сообщение от ${author}`}
        />
      </span>
      <div className={styles.queueBody}>
        <div className={styles.queueMeta}>
          {m.author ? (
            <Link to={`/profile/${m.author.id}`} className={styles.queueAuthor}>
              {author}
            </Link>
          ) : (
            <span className={styles.queueAuthor}>{author}</span>
          )}
          {m.author?.isOrganizer && <span>организатор</span>}
          <span>
            в событии <Link to={`/admin/events/${m.event.id}#discussion`}>{m.event.title}</Link>
          </span>
          <time dateTime={m.createdAt}>{formatAgo(m.createdAt)}</time>
        </div>

        <p className={[styles.quote, m.status === 'hidden' && styles.quoteHidden].filter(Boolean).join(' ')}>
          {m.text}
        </p>

        {m.status === 'hidden' ? (
          <p className={styles.flagNote}>
            <EyeSlashIcon size={18} aria-hidden />
            <span>Скрыто модератором: {m.hiddenReason || 'причина не указана'}</span>
          </p>
        ) : (
          m.aiFlag !== 'none' && (
            <p className={styles.flagNote}>
              <RobotIcon size={18} aria-hidden />
              <span>Помощник отметил: {flagTitle(m.aiFlag, 'message').toLowerCase()}</span>
              {m.aiReason && <span className={styles.flagReason}>{m.aiReason}</span>}
            </p>
          )
        )}

        <div className={styles.rowActions}>
          {m.status === 'hidden' ? (
            <Button size="sm" variant="secondary" onClick={onRestore} loading={busy}>
              Вернуть сообщение
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={onHide} disabled={busy}>
                Скрыть
              </Button>
              {m.aiFlag !== 'none' && (
                <Button size="sm" variant="secondary" onClick={onKeep} loading={busy}>
                  Оставить
                </Button>
              )}
            </>
          )}
          <Button
            size="sm"
            variant="quiet"
            aria-expanded={showContext}
            icon={
              showContext ? <CaretUpIcon size={18} aria-hidden /> : <CaretDownIcon size={18} aria-hidden />
            }
            onClick={() => setShowContext((v) => !v)}
          >
            {showContext ? 'Скрыть соседние' : 'Соседние сообщения'}
          </Button>
        </div>

        {showContext && <MessageContext message={m} />}
      </div>
    </li>
  );
}

/** Два сообщения до и два после — чтобы понять, о чём шла речь. */
function MessageContext({ message }: { message: MessageView }) {
  const { result, query } = useList<MessageView>({
    resource: 'messages',
    filters: [{ field: 'eventId', operator: 'eq', value: message.eventId }],
    pagination: { mode: 'off' },
  });
  if (query.isLoading) return <SkeletonText lines={3} />;
  if (query.isError)
    return <ErrorState title="Не удалось загрузить обсуждение" onRetry={() => void query.refetch()} />;
  const list = result?.data ?? [];
  const at = list.findIndex((x) => x.id === message.id);
  const around = list.slice(Math.max(0, at - 2), at + 3);
  return (
    <div className={styles.context} aria-label="Соседние сообщения">
      {around.map((x) => (
        <p
          key={x.id}
          className={[styles.contextItem, x.id === message.id && styles.contextCurrent]
            .filter(Boolean)
            .join(' ')}
        >
          <strong>{x.system ? 'Система' : (x.author?.orgName ?? x.author?.name ?? 'Участник')}</strong>
          {x.author?.isOrganizer && ' (организатор)'}:{' '}
          {x.text === null ? 'сообщение удалено' : truncate(x.text, 220)}
          <span className={styles.sub}> {formatAgo(x.createdAt)}</span>
        </p>
      ))}
      {list.length > around.length && (
        <Link to={`/admin/events/${message.eventId}#discussion`} className={styles.sub}>
          Всё обсуждение: {count(list.length, WORDS.message)}
        </Link>
      )}
    </div>
  );
}
