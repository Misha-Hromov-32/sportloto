import { ListChecks } from '@phosphor-icons/react';

import { EmptyState, ErrorState, Section, SkeletonBlock, StatusBadge } from '@/components';
import { formatAgo } from '@/lib/dates';

import { useMcpCalls } from './api';
import styles from './assistant.module.css';
import { callStatus } from './labels';

export function CallLog() {
  const { data: calls, isLoading, isError, refetch } = useMcpCalls();
  return (
    <Section title="Журнал вызовов">
      <div className={styles.stack}>
        <p className={styles.lead}>
          Здесь видно, когда и чем пользовался ассистент. Что именно он спрашивал и что получил в ответ, не сохраняется.
        </p>
        {isLoading ? (
          <div className={styles.stack} aria-busy="true" aria-label="Загружаем журнал">
            <SkeletonBlock height={48} />
            <SkeletonBlock height={48} />
            <SkeletonBlock height={48} />
          </div>
        ) : isError ? (
          <ErrorState title="Не удалось загрузить журнал" onRetry={() => void refetch()} />
        ) : !calls?.length ? (
          <EmptyState title="Вызовов пока не было" icon={<ListChecks size={28} aria-hidden />}>
            Когда ассистент воспользуется токеном, здесь появится запись.
          </EmptyState>
        ) : (
          <ul className={styles.log}>
            {calls.map((c) => (
              <li key={c.id} className={styles.logRow}>
                <span className={styles.logWhen}>{formatAgo(c.at)}</span>
                <span className={styles.logWhat}>
                  {c.label}
                  {c.tool && <code className={styles.argName}>{c.tool}</code>}
                </span>
                <span className={styles.logToken}>Токен «{c.tokenName}»</span>
                <StatusBadge kind="custom" meta={callStatus(c)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
