import { Plugs } from '@phosphor-icons/react';

import { Button } from '@/components';

import { useMcpTokens } from './api';
import styles from './assistant.module.css';

export function AssistantEntryIcon() {
  return <Plugs size={23} aria-hidden />;
}

export function AssistantEntry() {
  const { data: tokens } = useMcpTokens();
  const active = tokens?.filter((t) => t.status === 'active').length ?? 0;
  return (
    <div className={styles.entry}>
      <p className={styles.lead}>
        Ассистент с поддержкой MCP сможет искать для вас события и показывать расписание, а если разрешите, записывать. Доступ выдаётся личным токеном, его можно отозвать в любой момент.
      </p>
      {tokens && <p className={styles.muted}>{active ? `Действующих токенов: ${active}.` : 'Действующих токенов нет.'}</p>}
      <Button to="/settings/assistant" icon={<Plugs size={20} aria-hidden />}>
        Настроить подключение
      </Button>
    </div>
  );
}
