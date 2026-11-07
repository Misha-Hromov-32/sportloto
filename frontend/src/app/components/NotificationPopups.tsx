import { useList } from '@refinedev/core';
import { App } from 'antd';
import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';

import { useMe } from '@/lib/api';
import { hasBrowserSubscription, showLocalNotification } from '@/lib/webPush';
import { useSettings } from '@/theme/useSettings';
import type { NotificationType } from '@/types/domain';
import type { NotificationView } from '@/types/api';

import { BrowserPushPrompt } from './BrowserPushPrompt';

const CATEGORY: Partial<Record<NotificationType, 'applications' | 'changes' | 'answers'>> = {
  application: 'applications',
  joined: 'applications',
  left: 'applications',
  changed: 'changes',
  cancelled: 'changes',
  removed: 'changes',
  restored: 'changes',
  deleted: 'changes',
  question: 'answers',
  answer: 'answers',
  message_hidden: 'answers',
};

/**
 * Всплывающие сообщения о новых уведомлениях, пока человек на сайте:
 * так организатор сразу видит новую заявку, а участник — решение по ней.
 */
export function NotificationPopups() {
  const { me } = useMe();
  const { settings } = useSettings();
  const { notification } = App.useApp();
  const navigate = useNavigate();
  const seen = useRef<Set<string> | null>(null);
  const { result, query } = useList<NotificationView>({
    resource: 'notifications',
    pagination: { mode: 'off' },
    filters: [{ field: 'unread', operator: 'eq', value: true }],
    liveMode: 'auto',
  });
  const items = query.isSuccess ? result.data : undefined;

  useEffect(() => {
    if (!items) return;
    if (seen.current === null) {
      // Первый ответ после входа — это уже накопленные уведомления, их не показываем всплывающими.
      if (query.isFetching) return;
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const fresh = items.filter((n) => !seen.current!.has(n.id));
    fresh.forEach((n) => seen.current!.add(n.id));
    // Вкладка в фоне, а Web Push этому браузеру не подключён (нет ключей сервера или подписки):
    // системное уведомление показывает сама страница.
    if (fresh.length && document.hidden)
      void hasBrowserSubscription().then((pushed) => {
        if (pushed) return;
        for (const n of fresh.slice(0, 3)) void showLocalNotification(n.title, n.text, n.link, n.id);
      });
    if (!settings.notify.popups) return;
    for (const n of fresh.slice(0, 3)) {
      const category = CATEGORY[n.type];
      if (category && !settings.notify[category]) continue;
      notification.open({
        key: n.id,
        message: n.title,
        description: n.text,
        duration: 6,
        onClick: () => {
          navigate(n.link);
          notification.destroy(n.id);
        },
        style: { cursor: 'pointer' },
      });
    }
  }, [items, query.isFetching, settings.notify, notification, navigate]);

  return me ? <BrowserPushPrompt userId={me.id} /> : null;
}
