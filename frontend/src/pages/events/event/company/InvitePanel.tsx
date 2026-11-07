import { App, Input } from 'antd';
import { useState } from 'react';
import { Button, ErrorState } from '@/components';
import { count, WORDS } from '@/lib/plural';
import { API, useAction, useLiveGet } from '@/lib/api';
import type { EventDetails, InviteLinkView, InviteSendResult } from '@/types/api';
import styles from './Company.module.css';

export function InvitePanel({ event: e }: { event: EventDetails }) {
  const enabled = e.isOrganizer && e.visibility === 'invite';
  const { data, isError, refetch } = useLiveGet<InviteLinkView>(
    API.inviteLink(e.id),
    ['events', 'invites', 'demo'],
    enabled,
  );
  const { run, isPending } = useAction<InviteSendResult>();
  const [people, setPeople] = useState('');
  const [result, setResult] = useState<InviteSendResult | null>(null);
  const { modal, message } = App.useApp();
  if (!enabled) return null;
  const copy = async () => {
    if (!data) return;
    const url = `${window.location.origin}${data.path}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success('Приглашение скопировано');
    } catch {
      modal.info({ title: 'Ссылка-приглашение', content: <Input.TextArea readOnly value={url} autoSize /> });
    }
  };
  const rotate = () =>
    modal.confirm({
      title: 'Заменить приглашение?',
      content:
        'Прежняя ссылка перестанет работать для новых гостей. Уже записавшиеся участники сохранят доступ.',
      okText: 'Заменить ссылку',
      cancelText: 'Оставить',
      onOk: async () => {
        await run(API.rotateInviteLink(e.id));
        await refetch();
      },
    });
  const invite = async () => {
    try {
      const sent = await run(API.inviteOwn(e.id), {
        people: people
          .split(/[\n,;]+/)
          .map((p) => p.trim())
          .filter(Boolean),
      });
      setResult(sent);
    } catch {
      /* сообщение API */
    }
  };
  return (
    <section className={styles.panel} aria-label="Приглашения на закрытую встречу">
      <h2>Встреча для своих</h2>
      <p>Событие скрыто из общего поиска. Отправьте личную ссылку тем, кого ждёте.</p>
      {isError ? (
        <ErrorState title="Не удалось получить приглашение" onRetry={() => void refetch()} />
      ) : (
        data && (
          <>
            <p className={styles.link}>
              {window.location.origin}
              {data.path}
            </p>
            <div className={styles.actions}>
              <Button variant="primary" onClick={() => void copy()}>
                Скопировать приглашение
              </Button>
              <Button variant="quiet" disabled={isPending} onClick={rotate}>
                Заменить ссылку
              </Button>
            </div>
            <p>Действующую ссылку открыли: {count(data.opened, WORDS.person)}.</p>
            {data.company && (
              <div className={styles.stack}>
                <h3>Пригласить своих</h3>
                <label>
                  Имена или почта коллег
                  <Input.TextArea
                    value={people}
                    onChange={(ev) => setPeople(ev.target.value)}
                    placeholder="Каждый человек с новой строки"
                    rows={3}
                  />
                </label>
                <Button
                  variant="secondary"
                  loading={isPending}
                  disabled={!people.trim()}
                  onClick={() => void invite()}
                >
                  Отправить приглашения
                </Button>
                {result && (
                  <div className={styles.note} role="status">
                    Приглашены: {result.sent.map((p) => p.name).join(', ') || '—'}. Уже приглашены:{' '}
                    {result.already.map((p) => p.name).join(', ') || '—'}.
                    {result.notFound.length > 0 &&
                      ` Не нашли: ${result.notFound.join(', ')}. Уточните имя или почту.`}
                  </div>
                )}
              </div>
            )}
          </>
        )
      )}
    </section>
  );
}
