import { BellRingingIcon, XIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';

import { Button } from '@/components';
import { getDeliverySettings, updateDeliverySettings } from '@/lib/delivery';
import { browserPermission, enableBrowserPush } from '@/lib/webPush';

import styles from './BrowserPushPrompt.module.css';

const SHOW_AFTER_MS = 6000;
const ASK_AGAIN_MS = 14 * 24 * 60 * 60 * 1000;
const key = (userId: string) => `sport.pushPrompt.${userId}`;

function dismissedRecently(userId: string): boolean {
  try {
    const at = Number(localStorage.getItem(key(userId)) ?? 0);
    return Date.now() - at < ASK_AGAIN_MS;
  } catch {
    return true;
  }
}

function remember(userId: string) {
  try {
    localStorage.setItem(key(userId), String(Date.now()));
  } catch {
    /* без хранилища просто спросим в следующий раз */
  }
}

/**
 * Один раз предлагает включить уведомления в браузере. Разрешение браузер спрашивает только
 * после нажатия «Включить» — так его не запрещают по ошибке. «Не сейчас» — снова через две недели.
 */
export function BrowserPushPrompt({ userId }: { userId: string }) {
  const { message } = App.useApp();
  const { pathname } = useLocation();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  const quietPage = /^\/(assistant|settings|login|register)(\/|$)/.test(pathname);

  useEffect(() => {
    if (quietPage || browserPermission() !== 'default' || dismissedRecently(userId)) return;
    const timer = window.setTimeout(() => setVisible(true), SHOW_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [userId, quietPage]);

  if (!visible || quietPage) return null;

  const close = () => {
    remember(userId);
    setVisible(false);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const settings = await getDeliverySettings();
      const result = await enableBrowserPush(settings.pushKey);
      if (result === 'granted') {
        await updateDeliverySettings({ browser: true });
        message.success('Уведомления будут приходить в этот браузер');
      } else if (result === 'denied') {
        message.info('Браузер запретил уведомления. Включить их можно в настройках сайта в браузере');
      }
      close();
    } catch {
      message.error('Не удалось включить уведомления. Попробуйте в «Настройках»');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={styles.prompt}
      role="dialog"
      aria-labelledby="push-prompt-title"
      aria-describedby="push-prompt-text"
    >
      <span className={styles.icon} aria-hidden>
        <BellRingingIcon size={22} />
      </span>
      <div className={styles.body}>
        <p id="push-prompt-title" className={styles.title}>
          Уведомления в браузере
        </p>
        <p id="push-prompt-text" className={styles.text}>
          Заявки, ответы организатора и переносы встреч будут приходить, даже когда сайт закрыт.
        </p>
        <div className={styles.actions}>
          <Button variant="primary" size="sm" onClick={() => void enable()} disabled={busy}>
            Включить
          </Button>
          <Button variant="quiet" size="sm" onClick={close}>
            Не сейчас
          </Button>
        </div>
      </div>
      <button type="button" className={styles.close} aria-label="Закрыть" onClick={close}>
        <XIcon size={18} aria-hidden />
      </button>
    </div>
  );
}
