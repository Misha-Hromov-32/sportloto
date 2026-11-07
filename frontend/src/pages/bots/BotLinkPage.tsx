import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
} from '@phosphor-icons/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router';

import { Button, ErrorState, GoneState, PageSkeleton } from '@/components';
import { useMe } from '@/lib/api';
import {
  botAddress,
  isPlatform,
  PLATFORM_NAME,
  useBotsConfig,
  type BotPlatform,
  type BotsConfig,
} from '@/pages/settings/bots/api';
import { BotLogo } from '@/pages/settings/bots/BotLogo';
import { OpenBotLink, TicketView } from '@/pages/settings/bots/TicketView';
import { useLinkFlow } from '@/pages/settings/bots/useLinkFlow';

import styles from './BotLinkPage.module.css';

const SETTINGS = '/settings#settings-messengers';

function SettingsButton() {
  return (
    <Button variant="secondary" to={SETTINGS} icon={<GearSixIcon size={20} aria-hidden />}>
      Открыть настройки
    </Button>
  );
}

function Shell({ platform, title, children }: { platform: BotPlatform; title: string; children: ReactNode }) {
  return (
    <div className={`container ${styles.page}`}>
      <section className={styles.panel} aria-labelledby="bot-link-title">
        <header className={styles.head}>
          <BotLogo platform={platform} size="lg" />
          <h1 id="bot-link-title" className={styles.title}>
            {title}
          </h1>
        </header>
        {children}
      </section>
    </div>
  );
}

/** Вход уже есть: сразу выдаём ссылку-привязку и ждём, пока бот её примет. */
function Linking({ platform, config }: { platform: BotPlatform; config: BotsConfig }) {
  const flow = useLinkFlow(platform);
  const name = PLATFORM_NAME[platform];
  const botUrl = botAddress(platform, config);
  const started = useRef(false);
  const ready = Boolean(flow.links.data) || flow.links.isError;

  const { start } = flow;
  useEffect(() => {
    if (!ready || started.current) return;
    started.current = true;
    void start({ openBot: false });
  }, [ready, start]);

  if (flow.linked)
    return (
      <Shell platform={platform} title={`${name} подключён`}>
        <p className={styles.done} role="status">
          <CheckCircleIcon size={24} weight="fill" aria-hidden />
          Готово. Бот действует от имени аккаунта {flow.linked.displayName}.
        </p>
        <div className={styles.actions}>
          {botUrl && <OpenBotLink platform={platform} href={botUrl} label={`Вернуться в ${name}`} primary />}
          <Button variant="secondary" to="/events" icon={<MagnifyingGlassIcon size={20} aria-hidden />}>
            Найти встречу на сайте
          </Button>
        </div>
      </Shell>
    );

  if (flow.failure && !flow.ticket)
    return (
      <Shell platform={platform} title={`Подключить ${name}`}>
        <p className={styles.error} role="alert">
          {flow.failure}
        </p>
        <div className={styles.actions}>
          <Button
            variant="primary"
            icon={<ArrowsClockwiseIcon size={20} aria-hidden />}
            loading={flow.issuing}
            loadingText="Получаем ссылку…"
            onClick={() => void flow.start({ openBot: false })}
          >
            Попробовать ещё раз
          </Button>
          <SettingsButton />
        </div>
      </Shell>
    );

  if (!flow.ticket)
    return (
      <div className="container">
        <PageSkeleton label="Получаем ссылку…" />
      </div>
    );

  return (
    <Shell platform={platform} title={`Подключить ${name}`}>
      <p className={styles.lead}>Вы вошли на сайт. Осталось вернуться в бота: он подключится сам.</p>
      <TicketView
        platform={platform}
        ticket={flow.ticket}
        left={flow.left}
        expired={flow.expired}
        botUrl={botUrl}
        botName={null}
        renewing={flow.issuing}
        onRenew={() => void flow.start({ openBot: false })}
        primary
      />
      {flow.failure && (
        <p className={styles.error} role="alert">
          {flow.failure}
        </p>
      )}
      <p className={styles.note}>Отключить бота можно в любой момент: «Настройки», раздел «Мессенджеры».</p>
    </Shell>
  );
}

/** Кнопка «Войти через сайт» из бота: вход или регистрация, затем ссылка обратно в мессенджер. */
export default function BotLinkPage() {
  const [params] = useSearchParams();
  const location = useLocation();
  const { me, isLoading } = useMe();
  const raw = params.get('platform');
  const config = useBotsConfig();

  if (!isPlatform(raw))
    return (
      <div className="container">
        <GoneState title="Ссылка неполная" actions={<SettingsButton />}>
          Не удалось определить, какого бота подключить. Откройте ссылку из бота ещё раз или подключите его в
          настройках.
        </GoneState>
      </div>
    );

  if (isLoading)
    return (
      <div className="container">
        <PageSkeleton />
      </div>
    );

  if (!me) {
    const back = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`${params.get('signup') === '1' ? '/register' : '/login'}?to=${back}`} replace />;
  }

  const name = PLATFORM_NAME[raw];

  if (config.isLoading)
    return (
      <div className="container">
        <PageSkeleton />
      </div>
    );

  if (config.isError || !config.data)
    return (
      <div className="container">
        <ErrorState layout="page" title="Не удалось открыть страницу" onRetry={() => void config.refetch()} />
      </div>
    );

  if (!config.data[raw].enabled)
    return (
      <div className="container">
        <GoneState title={`Бот в ${name} пока не работает`} actions={<SettingsButton />}>
          Он скоро заработает. Подключить его можно будет в настройках, раздел «Мессенджеры».
        </GoneState>
      </div>
    );

  return <Linking platform={raw} config={config.data} />;
}
