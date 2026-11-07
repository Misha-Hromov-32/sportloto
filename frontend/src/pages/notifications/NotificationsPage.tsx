import {
  BellRingingIcon,
  ChatCircleTextIcon,
  ChecksIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
} from '@phosphor-icons/react';
import { useList, useUpdate } from '@refinedev/core';
import { useMemo, useState } from 'react';

import { Button, EmptyState, ErrorState, SkeletonBlock } from '@/components';
import { API, useAction, useMe } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import { count, WORDS } from '@/lib/plural';
import { capitalize } from '@/lib/text';
import type { NotificationView } from '@/types/api';

import { NotificationItem } from './parts/NotificationItem';
import styles from './NotificationsPage.module.css';
import { PersonalPage } from '../shared/PersonalPage';

function dayTitle(iso: string, now = dayjs()): string {
  const d = dayjs(iso);
  if (d.isSame(now, 'day')) return 'Сегодня';
  if (d.isSame(now.subtract(1, 'day'), 'day')) return 'Вчера';
  return capitalize(d.format(d.isSame(now, 'year') ? 'dddd, D MMMM' : 'D MMMM YYYY'));
}

function groupByDay(items: NotificationView[]) {
  const groups = new Map<string, { title: string; items: NotificationView[] }>();
  for (const n of items) {
    const key = dayjs(n.createdAt).format('YYYY-MM-DD');
    const group = groups.get(key) ?? { title: dayTitle(n.createdAt), items: [] };
    group.items.push(n);
    groups.set(key, group);
  }
  return [...groups.entries()];
}

export default function NotificationsPage() {
  const { role } = useMe();
  const [onlyUnread, setOnlyUnread] = useState(false);
  const { result, query } = useList<NotificationView>({
    resource: 'notifications',
    pagination: { mode: 'off' },
    sorters: [{ field: 'createdAt', order: 'desc' }],
    liveMode: 'auto',
  });
  const { run, isPending } = useAction();
  const { mutate: markRead } = useUpdate<NotificationView>();

  const all = result.data;
  const unread = all.filter((n) => !n.read).length;
  const shown = useMemo(() => (onlyUnread ? all.filter((n) => !n.read) : all), [all, onlyUnread]);

  const open = (n: NotificationView) => {
    if (n.read) return;
    markRead({
      resource: 'notifications',
      id: n.id,
      values: { read: true },
      successNotification: false,
      errorNotification: false,
    });
  };

  return (
    <PersonalPage
      title="Уведомления"
      description="Ответы организаторов, решения по заявкам, переносы и новые записи на ваши события."
      icon={<BellRingingIcon size={28} />}
      value={query.isLoading || query.isError ? undefined : unread}
      summary={
        <>
          <strong>
            {query.isLoading
              ? 'Проверяем новые сообщения'
              : query.isError
                ? 'Ваши уведомления'
                : unread
                  ? 'Есть непрочитанные'
                  : 'Вы всё прочитали'}
          </strong>
          {query.isLoading || query.isError
            ? 'Новости о ваших занятиях'
            : unread
              ? 'Вы ещё не прочитали ' + count(unread, WORDS.notification)
              : 'Новые сообщения появятся здесь'}
        </>
      }
      actions={
        unread > 0 && (
          <Button
            variant="secondary"
            icon={<ChecksIcon size={20} aria-hidden />}
            loading={isPending}
            loadingText="Отмечаем…"
            onClick={() => {
              run(API.readNotifications, {}).catch(() => undefined);
              setOnlyUnread(false);
            }}
          >
            Прочитать всё
          </Button>
        )
      }
    >
      <div className={styles.layout}>
        <div className={styles.main}>
          {all.length > 0 && (
            <div className={styles.toolbar}>
              <h2>Входящие</h2>
              <div className={styles.filters} role="group" aria-label="Какие уведомления показать">
                <button
                  type="button"
                  aria-pressed={!onlyUnread}
                  className={!onlyUnread ? styles.filterActive : undefined}
                  onClick={() => setOnlyUnread(false)}
                >
                  Все<span>{all.length}</span>
                </button>
                <button
                  type="button"
                  aria-pressed={onlyUnread}
                  className={onlyUnread ? styles.filterActive : undefined}
                  onClick={() => setOnlyUnread(true)}
                  disabled={!unread}
                >
                  Непрочитанные<span>{unread}</span>
                </button>
              </div>
            </div>
          )}

          {query.isError ? (
            <ErrorState onRetry={() => void query.refetch()}>
              Не удалось загрузить уведомления. Проверьте интернет и нажмите «Повторить».
            </ErrorState>
          ) : query.isLoading ? (
            <div className={styles.skeleton} role="status" aria-live="polite">
              <span className="sr-only">Загружаем уведомления…</span>
              <SkeletonBlock width={140} height={28} />
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className={styles.skeletonRow} aria-hidden>
                  <SkeletonBlock width={24} height={24} />
                  <div className={styles.skeletonBody}>
                    <SkeletonBlock width="40%" height={18} />
                    <SkeletonBlock width="85%" height={14} />
                    <SkeletonBlock width={120} height={14} />
                  </div>
                </div>
              ))}
            </div>
          ) : !all.length ? (
            <EmptyState
              title="Уведомлений пока нет"
              actions={
                role !== 'admin' && (
                  <Button variant="primary" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
                    Найти встречу
                  </Button>
                )
              }
            >
              Здесь появятся решения по вашим заявкам, ответы организаторов, переносы и новые заявки на ваши
              события.
            </EmptyState>
          ) : !shown.length ? (
            <EmptyState
              title="Непрочитанных нет"
              icon={<ChecksIcon size={28} aria-hidden />}
              actions={<Button onClick={() => setOnlyUnread(false)}>Показать все</Button>}
            >
              Вы всё прочитали. Старые уведомления остаются в списке «Все».
            </EmptyState>
          ) : (
            <div className={styles.days} aria-live="polite">
              {groupByDay(shown).map(([key, group]) => (
                <section key={key} className={styles.day} aria-labelledby={`day-${key}`}>
                  <h2 id={`day-${key}`} className={styles.dayTitle}>
                    {group.title}
                  </h2>
                  <ul className={styles.list}>
                    {group.items.map((n) => (
                      <NotificationItem key={n.id} notice={n} onOpen={open} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
        <aside className={styles.side}>
          <section className={styles.settingsCard} aria-labelledby="notice-settings-title">
            <h2 id="notice-settings-title">Всплывающие сообщения</h2>
            <p>
              Выберите, о чём сообщать сразу, пока вы на сайте. В этом списке уведомления остаются всегда.
            </p>
            <Button
              variant="secondary"
              to="/settings#settings-notifications"
              icon={<SlidersHorizontalIcon size={20} aria-hidden />}
            >
              Настроить уведомления
            </Button>
          </section>
          <div className={styles.infoCard}>
            <ChatCircleTextIcon size={24} aria-hidden />
            <p>Нажмите на уведомление, чтобы открыть встречу или ответ в обсуждении.</p>
          </div>
        </aside>
      </div>
    </PersonalPage>
  );
}
