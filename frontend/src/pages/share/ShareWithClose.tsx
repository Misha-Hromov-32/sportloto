import { CopyIcon, LinkBreakIcon, ShareNetworkIcon, UsersIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { useId } from 'react';

import { Button, ErrorState, SkeletonBlock } from '@/components';
import { ENGAGEMENT_API, useAction, useLiveGet } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import type { EventDetails } from '@/types/api';
import type { ShareState } from '@/types/engagement';

import styles from './share.module.css';

/**
 * «Поделиться с близким» на карточке события у записавшегося: ссылка без входа
 * с временем, адресом и контактом организатора. Работает до конца встречи, её можно отозвать.
 */
export function ShareWithClose({ event: e }: { event: EventDetails }) {
  const open = e.state === 'upcoming' || e.state === 'live';
  if (!open || e.my?.status !== 'confirmed') return null;
  return <SharePanel event={e} />;
}

function SharePanel({ event: e }: { event: EventDetails }) {
  const titleId = useId();
  const fieldId = useId();
  const { message, modal } = App.useApp();
  const { run, isPending } = useAction<ShareState>();
  const { data, isLoading, isError, refetch } = useLiveGet<ShareState>(ENGAGEMENT_API.share(e.id), [
    'participations',
    'events',
  ]);
  const url = data?.link ? `${window.location.origin}${data.link.path}` : '';
  const until = data?.link ? dayjs(data.link.expiresAt) : null;

  const create = () =>
    void run(ENGAGEMENT_API.share(e.id), {}, { success: 'Ссылка готова. Отправьте её близкому' }).catch(
      () => undefined,
    );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      message.success('Ссылка скопирована');
    } catch {
      document.getElementById(fieldId)?.focus();
      (document.getElementById(fieldId) as HTMLInputElement | null)?.select();
      message.info('Ссылка выделена, скопируйте её');
    }
  };

  const send = () =>
    void navigator
      .share({ title: e.title, text: `Я иду на «${e.title}». Где и когда, смотрите по ссылке:`, url })
      .catch(() => undefined);

  const revoke = () =>
    modal.confirm({
      title: 'Отозвать ссылку?',
      content: 'Тот, у кого она есть, больше не увидит адрес и время. Новую ссылку можно сделать в любой момент.',
      okText: 'Отозвать ссылку',
      okButtonProps: { danger: true },
      cancelText: 'Оставить',
      onOk: () =>
        run(ENGAGEMENT_API.share(e.id), {}, { method: 'delete', success: 'Ссылка отозвана' }).catch(() => undefined),
    });

  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <h2 id={titleId} className={styles.panelTitle}>
        <UsersIcon size={22} aria-hidden />
        Поделиться с близким
      </h2>
      {isLoading ? (
        <SkeletonBlock height={44} />
      ) : isError || !data ? (
        <ErrorState onRetry={() => void refetch()}>Не удалось проверить ссылку.</ErrorState>
      ) : !data.link ? (
        <>
          <p className={styles.text}>
            Пусть родные знают, где вы будете: время, адрес и контакт организатора. Ссылка откроется без входа
            и перестанет работать после встречи.
          </p>
          <Button
            variant="secondary"
            icon={<ShareNetworkIcon size={20} aria-hidden />}
            loading={isPending}
            loadingText="Готовим ссылку…"
            onClick={create}
          >
            Поделиться с близким
          </Button>
        </>
      ) : (
        <>
          <label htmlFor={fieldId} className={styles.label}>
            Ссылка для близкого
          </label>
          <input id={fieldId} className={styles.url} value={url} readOnly onFocus={(ev) => ev.target.select()} />
          <p className={styles.text}>
            Работает до {until!.format('D MMMM, HH:mm')}, потом перестанет открываться. Видно название, время, адрес,
            как найти и контакт организатора.
          </p>
          <div className={styles.actions}>
            <Button variant="primary" icon={<CopyIcon size={20} aria-hidden />} onClick={() => void copy()}>
              Скопировать ссылку
            </Button>
            {typeof navigator.share === 'function' && (
              <Button variant="secondary" icon={<ShareNetworkIcon size={20} aria-hidden />} onClick={send}>
                Отправить
              </Button>
            )}
            <Button variant="quiet" icon={<LinkBreakIcon size={20} aria-hidden />} onClick={revoke}>
              Отозвать ссылку
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
