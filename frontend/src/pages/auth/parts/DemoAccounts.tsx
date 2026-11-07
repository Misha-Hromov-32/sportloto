import { useLogin } from '@refinedev/core';
import { useState } from 'react';

import { Avatar, Button, StatusBadge } from '@/components';
import { useDemoAccounts, useMe, type DemoAccount } from '@/lib/api';
import type { OrgStatus } from '@/types/domain';

import styles from './DemoAccounts.module.css';

function targetPath(account: DemoAccount, explicit?: string): string {
  if (explicit) return explicit;
  return account.role === 'admin' ? '/admin' : '/events';
}

/**
 * Демо-доступы для экспертов: вход под любой ролью в один клик, без пароля.
 * Сервер отдаёт список только при DEMO_LOGIN_ENABLED=true, иначе блока на странице входа нет.
 */
export function DemoAccess({ redirectTo }: { redirectTo?: string }) {
  const { accounts } = useDemoAccounts();
  const { me } = useMe();
  const { mutate: login } = useLogin<{ userId: string; redirectTo: string }>();
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (accounts.length === 0) return null;

  return (
    <details className={styles.demo}>
      <summary className={styles.summary}>Проверяете прототип? Демо-аккаунты всех ролей</summary>
      <p className={styles.lead}>
        Все роли, включая администратора, входят в один клик, без пароля. Статус организации рядом с именем
        текущий: после допуска или отказа он меняется.
      </p>
      <ul className={styles.list}>
        {accounts.map((a) => {
          const current = me?.id === a.id;
          const org = a.orgs[0];
          return (
            <li key={a.id} className={[styles.item, current && styles.current].filter(Boolean).join(' ')}>
              <Avatar name={a.name} initials={a.initials} size={48} />
              <div className={styles.info}>
                <p className={styles.name}>
                  {a.name}
                  {a.age ? <span className={styles.age}>{a.age}</span> : null}
                </p>
                <p className={styles.role}>{org ? org.name : a.title}</p>
                {org && <StatusBadge kind="org" status={org.status as OrgStatus} />}
                <p className={styles.hint}>{a.hint}</p>
              </div>
              <Button
                variant={current ? 'quiet' : 'secondary'}
                size="sm"
                disabled={current}
                loading={pendingId === a.id}
                onClick={() => {
                  setPendingId(a.id);
                  const target = targetPath(a, redirectTo);
                  login(
                    { userId: a.id, redirectTo: target },
                    {
                      // Полная загрузка страницы после входа: шапка и все экраны читают новую сессию
                      // с нуля, без гонки между кэшем «гость» и перезапросом профиля.
                      onSuccess: (data) => {
                        if (data?.success) window.location.replace(data.redirectTo ?? target);
                      },
                      onSettled: () => setPendingId(null),
                    },
                  );
                }}
                aria-label={current ? `Вы вошли как ${a.name}` : `Войти как ${a.name}`}
              >
                {current ? 'Вы здесь' : 'Войти'}
              </Button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
