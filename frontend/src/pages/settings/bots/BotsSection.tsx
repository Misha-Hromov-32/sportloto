import { ChatsCircleIcon } from '@phosphor-icons/react';

import { ErrorState, SkeletonText } from '@/components';

import pageStyles from '../SettingsPage.module.css';
import { botAddress, PLATFORMS, useBotLinks, useBotsConfig } from './api';
import { BotCard } from './BotCard';
import styles from './bots.module.css';
import { ClaimForm } from './ClaimForm';

export function BotsSectionIcon() {
  return <ChatsCircleIcon size={23} aria-hidden />;
}

/** Настройки → Мессенджеры: привязка бота ВКонтакте к аккаунту. */
export function BotsSection() {
  const config = useBotsConfig();
  const links = useBotLinks(true, false);

  const intro = (
    <p className={pageStyles.sectionIntro}>
      Подключите бота ВКонтакте, чтобы искать встречи, записываться и получать уведомления. Пароль от сайта в
      чате не нужен.
    </p>
  );

  if (config.isLoading || links.isLoading) return <SkeletonText lines={5} />;

  if (config.isError || links.isError || !config.data || !links.data)
    return (
      <ErrorState
        layout="inline"
        title="Не удалось открыть раздел"
        onRetry={() => {
          void config.refetch();
          void links.refetch();
        }}
      >
        Проверьте интернет и нажмите «Повторить».
      </ErrorState>
    );

  const cfg = config.data;
  const anyEnabled = cfg.vk.enabled;
  const refresh = () => void links.refetch();

  return (
    <>
      {intro}
      <div className={styles.cards}>
        {PLATFORMS.map((p) => (
          <BotCard
            key={p}
            platform={p}
            enabled={cfg[p].enabled}
            links={links.data ?? []}
            botUrl={botAddress(p, cfg)}
            botName={null}
            onChanged={refresh}
          />
        ))}
      </div>
      {anyEnabled && <ClaimForm onLinked={refresh} />}
    </>
  );
}
