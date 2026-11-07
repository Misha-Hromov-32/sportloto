import { ArrowLeftIcon, Plugs } from '@phosphor-icons/react';
import { useState } from 'react';
import { Navigate } from 'react-router';

import { Button, ErrorState, NoAccessState, PageSkeleton } from '@/components';
import { useAiFeatures } from '@/lib/aiFeatures';
import { useMe } from '@/lib/api';
import { PersonalPage } from '../../shared/PersonalPage';

import { useMcpCatalog } from './api';
import styles from './assistant.module.css';
import { CallLog } from './CallLog';
import { ConnectGuide } from './ConnectGuide';
import { TokensSection } from './TokensSection';
import { ToolConsole } from './ToolConsole';

/** Подключение внешнего ассистента. Выключено в админке: сервер не отвечает, и показывать нечего. */
export default function AssistantPage() {
  const { features, loaded } = useAiFeatures();
  if (!loaded)
    return (
      <div className="container">
        <PageSkeleton />
      </div>
    );
  if (!features.mcp) return <Navigate to="/settings" replace />;
  return <ConnectAssistant />;
}

/** Права, инструкция, проверка и журнал. */
function ConnectAssistant() {
  const { isGuest, isLoading: meLoading } = useMe();
  const { data: catalog, isLoading, isError, refetch } = useMcpCatalog();
  const [token, setToken] = useState('');

  if (meLoading || isLoading)
    return (
      <div className="container">
        <PageSkeleton />
      </div>
    );

  return (
    <PersonalPage
      title="Подключить ассистента"
      description="Подключите ассистента с поддержкой MCP: он поможет искать встречи и вести расписание. Запись на занятия и подготовку черновиков можно разрешить отдельно."
      icon={<Plugs size={28} />}
      summary={
        <>
          <strong>Права выдаёте вы</strong>Ассистент действует от вашего имени и только в пределах выданных
          прав.
        </>
      }
      actions={
        <Button variant="quiet" to="/settings" icon={<ArrowLeftIcon size={18} aria-hidden />}>
          К настройкам
        </Button>
      }
    >
      <div className={styles.page}>
        {isGuest ? (
          <NoAccessState guest loginTo="/settings/assistant" title="Войдите, чтобы подключить ассистента">
            Токен выдаётся на ваш аккаунт: ассистент будет действовать от вашего имени.
          </NoAccessState>
        ) : isError || !catalog ? (
          <ErrorState layout="page" title="Не удалось загрузить раздел" onRetry={() => void refetch()} />
        ) : (
          <>
            <TokensSection
              catalog={catalog}
              onUseInConsole={(secret) => {
                setToken(secret);
                document.getElementById('console')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }}
            />
            <ConnectGuide catalog={catalog} />
            <ToolConsole catalog={catalog} token={token} onTokenChange={setToken} />
            <CallLog />
          </>
        )}
      </div>
    </PersonalPage>
  );
}
