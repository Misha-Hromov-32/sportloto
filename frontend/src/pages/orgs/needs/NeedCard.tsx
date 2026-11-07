import { CalendarBlankIcon, CheckIcon, HandshakeIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { Link } from 'react-router';

import { Avatar, Button, StatusBadge } from '@/components';
import { errorMessage, INVENTORY_API, useAction } from '@/lib/api';
import { dayjs } from '@/lib/dates';
import type { SupportNeedView } from '@/types/inventory';
import { dateInText, OFFER_STATUS, quoted, SUPPORT_STATUS } from '@/pages/inventory/labels';

import styles from './needs.module.css';

/**
 * Просьба клуба о помощи. Клуб видит отклики и принимает один, партнёр — свой отклик,
 * остальные — что нужно и кто уже помог.
 */
export function NeedCard({
  need,
  onOffer,
  showOrg = true,
}: {
  need: SupportNeedView;
  onOffer?: (need: SupportNeedView) => void;
  showOrg?: boolean;
}) {
  const { run, isPending } = useAction<SupportNeedView>();
  const { modal, message } = App.useApp();
  const status = need.overdue
    ? { label: 'Нужна помощь, срок прошёл', tone: 'wait' as const, icon: 'clock' as const }
    : SUPPORT_STATUS[need.status];
  const pending = need.offers.filter((o) => o.status === 'pending');

  const decide = (offerId: string, decision: 'accept' | 'decline', sponsor: string) =>
    void run(INVENTORY_API.decideOffer(need.id, offerId), { decision }, {
      success:
        decision === 'accept'
          ? `На странице клуба теперь написано: при поддержке ${sponsor}`
          : 'Партнёр получит ответ',
    }).catch(() => undefined);

  const cancel = () =>
    modal.confirm({
      title: 'Снять просьбу?',
      content: pending.length ? 'Партнёрам, которые откликнулись, придёт ответ, что помощь больше не нужна.' : undefined,
      okText: 'Снять просьбу',
      cancelText: 'Оставить',
      onOk: async () => {
        try {
          await run(INVENTORY_API.cancelSupport(need.id), {}, { silent: true });
          message.success('Просьба снята');
        } catch (e) {
          message.error(errorMessage(e));
        }
      },
    });

  return (
    <article className={styles.need} aria-labelledby={`need-${need.id}`}>
      <div className={styles.needHead}>
        {showOrg && (
          <Link to={need.org.link} className={styles.needOrg}>
            <Avatar name={need.org.name} src={need.org.avatarUrl} size={32} shape="org" />
            {need.org.name}
          </Link>
        )}
        <StatusBadge kind="custom" meta={status} />
      </div>
      <h3 id={`need-${need.id}`} className={styles.needTitle}>
        {need.title}
      </h3>
      {need.details && <p className={styles.needText}>{need.details}</p>}
      <ul className={styles.needFacts}>
        {need.deadline && (
          <li>
            <CalendarBlankIcon size={18} aria-hidden />
            Нужно до {dayjs(need.deadline).format('D MMMM')}
          </li>
        )}
        {need.event && (
          <li>
            <span>
              Для события <Link to={`/events/${need.event.id}`}>«{need.event.title}»</Link>,{' '}
              {dateInText(need.event.startsAt)}
            </span>
          </li>
        )}
      </ul>

      {need.closedBy && (
        <p className={styles.closed}>
          <HandshakeIcon size={20} aria-hidden />
          <span>
            Закрыто партнёром <Link to={need.closedBy.link}>{quoted(need.closedBy.name)}</Link>
          </span>
        </p>
      )}

      {need.isOwner && need.offers.length > 0 && (
        <div className={styles.offers}>
          <h4 className={styles.offersTitle}>Отклики партнёров</h4>
          {need.offers.map((o) => (
            <div key={o.id} className={styles.offer}>
              <div className={styles.offerHead}>
                <Link to={o.sponsor.link} className={styles.offerName}>
                  {o.sponsor.name}
                </Link>
                <StatusBadge kind="custom" meta={OFFER_STATUS[o.status]} />
              </div>
              <p className={styles.quote}>«{o.comment}»</p>
              {o.status === 'pending' && need.status === 'open' && (
                <div className={styles.actions}>
                  <Button
                    size="sm"
                    variant="primary"
                    icon={<CheckIcon size={18} weight="bold" aria-hidden />}
                    loading={isPending}
                    onClick={() => decide(o.id, 'accept', quoted(o.sponsor.name))}
                  >
                    Принять помощь
                  </Button>
                  <Button size="sm" variant="quiet" onClick={() => decide(o.id, 'decline', quoted(o.sponsor.name))}>
                    Отказаться
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {need.isOwner && need.status === 'open' && need.offers.length === 0 && (
        <p className={styles.muted}>Откликов пока нет. Когда партнёр предложит помощь, придёт уведомление.</p>
      )}

      {!need.isOwner && need.myOffer && (
        <div className={styles.offer}>
          <div className={styles.offerHead}>
            <span className={styles.offerName}>Ваш отклик</span>
            <StatusBadge kind="custom" meta={OFFER_STATUS[need.myOffer.status]} />
          </div>
          <p className={styles.quote}>«{need.myOffer.comment}»</p>
          {need.myOffer.status === 'pending' && (
            <div className={styles.actions}>
              <Button
                size="sm"
                variant="quiet"
                loading={isPending}
                onClick={() =>
                  void run(INVENTORY_API.withdrawOffer(need.id, need.myOffer!.id), {}, { success: 'Отклик отозван' }).catch(
                    () => undefined,
                  )
                }
              >
                Отозвать отклик
              </Button>
            </div>
          )}
        </div>
      )}

      {(onOffer && need.offerAs.length > 0) || (need.isOwner && need.status === 'open') ? (
        <div className={styles.actions}>
          {onOffer && need.offerAs.length > 0 && (
            <Button variant="secondary" icon={<HandshakeIcon size={20} aria-hidden />} onClick={() => onOffer(need)}>
              Поможем
            </Button>
          )}
          {need.isOwner && need.status === 'open' && (
            <Button size="sm" variant="quiet" onClick={cancel}>
              Снять просьбу
            </Button>
          )}
        </div>
      ) : null}
    </article>
  );
}
