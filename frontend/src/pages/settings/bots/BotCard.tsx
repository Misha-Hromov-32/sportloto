import {
  BellRingingIcon,
  CalendarPlusIcon,
  CheckCircleIcon,
  LinkBreakIcon,
  LinkIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  XIcon,
} from '@phosphor-icons/react';
import { Popconfirm } from 'antd';
import type { ReactNode } from 'react';

import { Button, StatusBadge } from '@/components';
import { useAction } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import type { StatusMeta } from '@/lib/labels';

import { BotLogo } from './BotLogo';
import { BOTS_API, PLATFORM_NAME, type BotLink, type BotPlatform } from './api';
import styles from './bots.module.css';
import { TicketView } from './TicketView';
import { useLinkFlow } from './useLinkFlow';

const CONNECTED: StatusMeta = { label: 'Подключён', tone: 'ok', icon: 'check' };
const NOT_CONNECTED: StatusMeta = { label: 'Не подключён', tone: 'neutral', icon: 'cross' };
const SOON: StatusMeta = { label: 'Скоро', tone: 'off', icon: 'clock' };

const ABILITIES: { icon: ReactNode; text: string }[] = [
  { icon: <MagnifyingGlassIcon size={20} aria-hidden />, text: 'Искать встречи и записываться' },
  { icon: <CalendarPlusIcon size={20} aria-hidden />, text: 'Создавать встречи и разбирать заявки' },
  { icon: <BellRingingIcon size={20} aria-hidden />, text: 'Получать уведомления' },
];

function relativeDay(iso: string): string {
  const d = dayjs(iso);
  const now = dayjs();
  if (d.isSame(now, 'day')) return 'сегодня';
  if (d.isSame(now.subtract(1, 'day'), 'day')) return 'вчера';
  return d.format(d.isSame(now, 'year') ? 'D MMMM' : 'D MMMM YYYY');
}

function linkDetails(link: BotLink): string {
  const created = dayjs(link.createdAt);
  const since = `подключён ${created.format(created.isSame(dayjs(), 'year') ? 'D MMMM' : 'D MMMM YYYY')}`;
  return link.lastUsedAt ? `${since}, последний раз ${relativeDay(link.lastUsedAt)}` : since;
}

function LinkRow({ link, onRemoved }: { link: BotLink; onRemoved: () => void }) {
  const { run, isPending } = useAction();
  const name = PLATFORM_NAME[link.platform];
  return (
    <li className={styles.linkRow}>
      <div className={styles.linkText}>
        <span className={styles.linkName}>{link.displayName}</span>
        <span className={styles.linkMeta}>{linkDetails(link)}</span>
      </div>
      <Popconfirm
        title={`Отключить ${name} ${link.displayName}?`}
        description="Бот сразу перестанет действовать от вашего имени. Подключить снова можно в любой момент."
        okText="Отключить"
        cancelText="Оставить"
        okButtonProps={{ danger: true }}
        onConfirm={() =>
          run(BOTS_API.link(link.id), {}, { method: 'delete', success: `${name} отключён` })
            .then(onRemoved)
            .catch(() => undefined)
        }
      >
        <Button
          variant="secondary"
          icon={<LinkBreakIcon size={20} aria-hidden />}
          loading={isPending}
          loadingText="Отключаем…"
        >
          Отключить
        </Button>
      </Popconfirm>
    </li>
  );
}

export function BotCard({
  platform,
  enabled,
  links,
  botUrl,
  botName,
  onChanged,
}: {
  platform: BotPlatform;
  enabled: boolean;
  links: BotLink[];
  botUrl: string | null;
  botName: string | null;
  onChanged: () => void;
}) {
  const flow = useLinkFlow(platform);
  const name = PLATFORM_NAME[platform];
  const own = links.filter((l) => l.platform === platform);
  const open = Boolean(flow.ticket) && !flow.linked;
  const titleId = `bot-${platform}-title`;

  return (
    <article className={styles.card} aria-labelledby={titleId}>
      <header className={styles.cardHead}>
        <BotLogo platform={platform} />
        <h3 id={titleId} className={styles.cardTitle}>
          Бот в {name}
        </h3>
        <StatusBadge kind="custom" meta={!enabled ? SOON : own.length ? CONNECTED : NOT_CONNECTED} />
      </header>

      <ul className={styles.abilities} aria-label="Что умеет бот">
        {ABILITIES.map((a) => (
          <li key={a.text}>
            {a.icon}
            {a.text}
          </li>
        ))}
      </ul>

      {!enabled ? (
        <p className={styles.soon}>Бот в {name} скоро заработает. Подключить его можно будет здесь же.</p>
      ) : (
        <>
          {own.length > 0 && (
            <ul className={styles.links} aria-label={`Подключённые аккаунты ${name}`}>
              {own.map((l) => (
                <LinkRow key={l.id} link={l} onRemoved={onChanged} />
              ))}
            </ul>
          )}

          {flow.linked && (
            <p className={styles.done} role="status">
              <CheckCircleIcon size={22} weight="fill" aria-hidden />
              Готово, {name} подключён
            </p>
          )}

          {open && flow.ticket ? (
            <div className={styles.window}>
              <TicketView
                platform={platform}
                ticket={flow.ticket}
                left={flow.left}
                expired={flow.expired}
                botUrl={botUrl}
                botName={botName}
                renewing={flow.issuing}
                onRenew={() => void flow.start({ openBot: true })}
              />
              <Button
                variant="quiet"
                className={styles.closeWindow}
                icon={<XIcon size={20} aria-hidden />}
                onClick={flow.close}
              >
                Закрыть
              </Button>
            </div>
          ) : (
            <Button
              variant={own.length ? 'secondary' : 'primary'}
              icon={own.length ? <PlusIcon size={20} aria-hidden /> : <LinkIcon size={20} aria-hidden />}
              className={`${styles.connect} ${styles.wrap}`}
              loading={flow.issuing}
              loadingText="Получаем ссылку…"
              onClick={() => void flow.start({ openBot: true })}
            >
              {own.length ? 'Подключить другой аккаунт' : `Подключить ${name}`}
            </Button>
          )}

          {flow.failure && (
            <p className={styles.error} role="alert">
              {flow.failure}
            </p>
          )}
        </>
      )}
    </article>
  );
}
