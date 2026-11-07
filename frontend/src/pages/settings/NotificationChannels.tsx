import { App, Button, Segmented, Switch } from 'antd';
import { useEffect, useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import {
  getDeliverySettings,
  sendTestNotification,
  updateDeliverySettings,
  type ChannelResult,
  type DeliveryPatch,
  type DeliverySettings,
  type MessengersMode,
} from '@/lib/delivery';
import {
  browserPermission,
  disableBrowserPush,
  enableBrowserPush,
  hasBrowserSubscription,
  pushSupported,
  type BrowserPermission,
} from '@/lib/webPush';

import styles from './NotificationChannels.module.css';

const MESSENGER_OPTIONS: { value: MessengersMode; label: string }[] = [
  { value: 'all', label: 'Все' },
  { value: 'important', label: 'Важные' },
  { value: 'off', label: 'Выключено' },
];

const RESULT_TEXT: Record<ChannelResult, string> = {
  sent: 'отправлено',
  off: 'выключено',
  failed: 'не получилось',
  unavailable: 'недоступно',
};

function Row({
  title,
  hint,
  control,
}: {
  title: string;
  hint: ReactNode;
  control: (ids: { title: string; hint: string }) => ReactNode;
}) {
  const id = useId();
  const ids = { title: `${id}-title`, hint: `${id}-hint` };
  return (
    <div className={styles.row}>
      <div className={styles.text}>
        <span id={ids.title} className={styles.title}>
          {title}
        </span>
        <span id={ids.hint} className={styles.hint}>
          {hint}
        </span>
      </div>
      <div className={styles.control}>{control(ids)}</div>
    </div>
  );
}

/**
 * Куда ещё приходят уведомления сайта: в браузер (даже когда сайт закрыт), на почту и в мессенджеры.
 * Колокольчик на сайте работает всегда, эти каналы — дополнительно.
 */
export function NotificationChannels() {
  const { message } = App.useApp();
  const [data, setData] = useState<DeliverySettings | null>(null);
  const [failed, setFailed] = useState(false);
  const [permission, setPermission] = useState<BrowserPermission>(() => browserPermission());
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState<'browser' | 'email' | 'messengers' | 'test' | null>(null);

  useEffect(() => {
    let alive = true;
    getDeliverySettings()
      .then((s) => alive && setData(s))
      .catch(() => alive && setFailed(true));
    void hasBrowserSubscription().then((v) => alive && setSubscribed(v));
    return () => {
      alive = false;
    };
  }, []);

  const save = async (patch: DeliveryPatch, field: 'browser' | 'email' | 'messengers') => {
    setBusy(field);
    try {
      setData(await updateDeliverySettings(patch));
    } catch {
      message.error('Не удалось сохранить. Проверьте интернет и попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  };

  const toggleBrowser = async (on: boolean) => {
    if (!data) return;
    setBusy('browser');
    try {
      if (on) {
        const result = await enableBrowserPush(data.pushKey);
        setPermission(result);
        if (result !== 'granted') {
          message.info(
            result === 'denied'
              ? 'Браузер запретил уведомления для сайта. Разрешите их в настройках сайта в браузере'
              : 'Уведомления не включены',
          );
          return;
        }
        setSubscribed(await hasBrowserSubscription());
      } else {
        await disableBrowserPush();
        setSubscribed(false);
      }
      setData(await updateDeliverySettings({ browser: on }));
    } catch {
      message.error('Не удалось включить уведомления в этом браузере. Попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  };

  const test = async () => {
    setBusy('test');
    try {
      const result = await sendTestNotification();
      message.success(`Почта: ${RESULT_TEXT[result.email]}. Браузер: ${RESULT_TEXT[result.browser]}`);
    } catch {
      message.error('Не удалось отправить проверку. Попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  };

  if (failed)
    return <p className={styles.notice}>Не удалось загрузить настройки доставки. Обновите страницу.</p>;
  if (!data) return <p className={styles.notice}>Загружаем настройки доставки…</p>;

  const browserOn = data.browser && permission === 'granted' && (!data.pushAvailable || subscribed);
  const browserHint =
    permission === 'unsupported'
      ? 'Этот браузер не умеет показывать уведомления сайта.'
      : permission === 'denied'
        ? 'Уведомления для сайта запрещены в настройках браузера. Разрешите их там, затем включите здесь.'
        : 'Системное уведомление на телефоне или компьютере, даже когда сайт закрыт. Включается для этого браузера.';
  const emailHint = data.emailDeliverable
    ? `Письмо на ${data.emailAddress} о каждом новом уведомлении.`
    : data.emailAddress
      ? `На адрес ${data.emailAddress} письма не дойдут. Укажите настоящую почту в профиле.`
      : 'Почта в профиле не указана.';
  const linked = data.bots.vk;

  return (
    <div className={styles.root} id="notification-channels">
      <p className={styles.lead}>
        Уведомления всегда видны под колокольчиком на сайте. Здесь можно получать их ещё и так:
      </p>
      <Row
        title="В браузере"
        hint={browserHint}
        control={(ids) => (
          <Switch
            checked={browserOn}
            loading={busy === 'browser'}
            disabled={permission === 'unsupported' || permission === 'denied' || !pushSupported()}
            onChange={(v) => void toggleBrowser(v)}
            aria-labelledby={ids.title}
            aria-describedby={ids.hint}
          />
        )}
      />
      <Row
        title="На почту"
        hint={emailHint}
        control={(ids) => (
          <Switch
            checked={data.email && data.emailDeliverable}
            loading={busy === 'email'}
            disabled={!data.emailDeliverable}
            onChange={(v) => void save({ email: v }, 'email')}
            aria-labelledby={ids.title}
            aria-describedby={ids.hint}
          />
        )}
      />
      <Row
        title="В мессенджерах"
        hint={
          linked ? (
            <>
              Бот ВКонтакте присылает уведомления в личные сообщения.{' '}
              <Link to="/settings#settings-messengers">Настроить ботов</Link>
            </>
          ) : (
            <>
              Подключите бота ВКонтакте, и уведомления будут приходить туда.{' '}
              <Link to="/settings#settings-messengers">Подключить</Link>
            </>
          )
        }
        control={(ids) => (
          <Segmented<MessengersMode>
            size="middle"
            value={data.messengers}
            options={MESSENGER_OPTIONS}
            disabled={busy === 'messengers'}
            onChange={(v) => void save({ messengers: v }, 'messengers')}
            aria-labelledby={ids.title}
          />
        )}
      />
      <div className={styles.footer}>
        <Button onClick={() => void test()} loading={busy === 'test'}>
          Прислать проверочное уведомление
        </Button>
      </div>
    </div>
  );
}
