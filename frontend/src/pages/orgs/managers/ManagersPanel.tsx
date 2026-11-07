import { Input, Modal } from 'antd';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { Button, ErrorState } from '@/components';
import { errorMessage, useAction, useLiveGet, useMe } from '@/lib/api';

interface Member {
  id: string;
  name: string;
  email: string;
  at?: string;
}
interface Managers {
  canEdit: boolean;
  owner: Member;
  managers: Member[];
}

export function ManagersPanel({ orgId }: { orgId: string }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const url = `/organizations/${orgId}/managers`;
  const state = useLiveGet<Managers>(url, ['organizations', 'users']);
  const { run, isPending } = useAction();
  const [removing, setRemoving] = useState<Member | null>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await run(url, { email: email.trim() }, { silent: true, success: 'Управляющий добавлен' });
      setEmail('');
      await state.refetch();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const remove = async () => {
    if (!removing) return;
    try {
      await run(`${url}/${removing.id}`, {}, { method: 'delete', success: 'Доступ отозван' });
      setRemoving(null);
      if (removing.id === me?.id) navigate(`/orgs/${orgId}`);
      else await state.refetch();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <section aria-labelledby="org-managers-title">
      <h2 id="org-managers-title">Управляющие клуба</h2>
      <p>
        Владелец управляет страницей и доступом. До пяти соуправляющих могут публиковать встречи от имени
        клуба и рассматривать заявки участников.
      </p>
      {state.isError ? (
        <ErrorState title="Не удалось загрузить управляющих" onRetry={() => void state.refetch()} />
      ) : !state.data ? (
        <p role="status">Загружаем управляющих…</p>
      ) : (
        <>
          <p>
            Владелец: <strong>{state.data.owner.name}</strong>
          </p>
          {state.data.managers.length ? (
            <ul>
              {state.data.managers.map((person) => (
                <li key={person.id}>
                  <strong>{person.name}</strong> · {person.email}{' '}
                  {(state.data?.canEdit || person.id === me?.id) && (
                    <Button
                      size="sm"
                      variant="quiet"
                      loading={isPending}
                      onClick={() => {
                        setError('');
                        setRemoving(person);
                      }}
                    >
                      {person.id === me?.id ? 'Выйти из управляющих' : 'Убрать доступ'}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>Соуправляющих пока нет.</p>
          )}
          {state.data.canEdit && (
            <form onSubmit={(e) => void add(e)}>
              <label htmlFor="manager-email">Почта зарегистрированного человека</label>
              <Input
                id="manager-email"
                type="email"
                required
                value={email}
                maxLength={254}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="off"
                aria-invalid={Boolean(error)}
              />
              {error && <p role="alert">{error}</p>}
              <Button
                type="submit"
                variant="secondary"
                loading={isPending}
                disabled={state.data.managers.length >= 5}
              >
                Добавить управляющего
              </Button>
            </form>
          )}
        </>
      )}
      <Modal
        open={Boolean(removing)}
        title={
          removing?.id === me?.id ? 'Выйти из управляющих?' : `Отозвать доступ: ${removing?.name ?? ''}?`
        }
        onCancel={() => setRemoving(null)}
        onOk={() => void remove()}
        confirmLoading={isPending}
        okText={removing?.id === me?.id ? 'Выйти' : 'Убрать доступ'}
        cancelText="Отмена"
        okButtonProps={{ danger: true }}
        destroyOnHidden
      >
        <p>Доступ к управлению встречами клуба прекратится. Личные записи на встречи сохранятся.</p>
        {error && <p role="alert">{error}</p>}
      </Modal>
    </section>
  );
}
