import { CheckIcon, ClockCountdownIcon, InfoIcon, MedalIcon, UserIcon, XIcon } from '@phosphor-icons/react';
import { useOne } from '@refinedev/core';
import { Checkbox, Input } from 'antd';
import { useId, useState } from 'react';
import { Link } from 'react-router';

import { Avatar, Button, Chip, StopAddDialog, stopOwnerOf } from '@/components';
import { API, useAction } from '@/lib/api';
import { formatAgo } from '@/lib/dates';
import { SKILL_LEVEL } from '@/lib/labels';
import { count } from '@/lib/plural';
import type { EventDetails, ParticipantView, UserView } from '@/types/api';

import styles from './manage.module.css';
import { REJECT_TEMPLATES } from './rejectTemplates';
import { EscortMark } from '../venues/EscortOption'; // Н1
import { YEAR_WORDS, ageText } from '../event/company/labels';
import { StopListedMark } from './PersonActions'; // D-16

interface ApplicationCardProps {
  application: ParticipantView;
  profile: UserView | undefined;
  full: boolean;
  fresh: boolean;
  editLink: string;
}

/** Заявка: кто, какой уровень, что написал, сколько встреч было. Решение — «Принять» или «Отклонить». */
export function ApplicationCard({ application, profile, full, fresh, editLink }: ApplicationCardProps) {
  const { run } = useAction();
  const [mode, setMode] = useState<'idle' | 'rejecting'>('idle');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null);
  const [stopToo, setStopToo] = useState(false);
  const [stopOpen, setStopOpen] = useState(false);
  // Событие уже загружено страницей управления: берём из кэша, чтобы знать, чей стоп-лист.
  const { result: event } = useOne<EventDetails>({ resource: 'events', id: application.eventId });
  const owner = event?.organizer ? stopOwnerOf(event.organizer) : null;
  const reasonId = useId();
  const fullHintId = useId();
  const { user } = application;
  const attended = profile?.facts.attended;

  const rejectQuietly = () =>
    run(API.decideParticipation(application.id), { decision: 'reject', reason: reason.trim() }, {});

  const decide = async (decision: 'accept' | 'reject') => {
    if (decision === 'reject' && stopToo && owner) {
      setStopOpen(true);
      return;
    }
    setBusy(decision);
    try {
      await run(
        API.decideParticipation(application.id),
        decision === 'reject' ? { decision, reason: reason.trim() } : { decision },
        {
          success:
            decision === 'accept'
              ? `${user.name} теперь участник. Уведомление отправлено`
              : 'Заявка отклонена. Человек увидит ответ в своих занятиях',
        },
      );
    } catch {
      setBusy(null);
    }
  };

  return (
    <article
      className={[styles.card, fresh && styles.cardFresh, fresh && 'status-flash'].filter(Boolean).join(' ')}
      aria-label={`Заявка: ${user.name}`}
    >
      {!!application.children?.length && (
        <p>С детьми: {application.children.map((c) => `${c.name}, ${ageText(c.age)}`).join('; ')}</p>
      )}
      <div className={styles.cardHead}>
        <Avatar name={user.name} initials={user.initials} src={user.avatarUrl} size={56} />
        <div className={styles.personBody}>
          <Link to={`/profile/${user.id}`} className={styles.personName}>
            {user.name}
          </Link>
          {application.stopListed && (
            <span className={styles.personBadges}>
              <StopListedMark on />
            </span>
          )}
          <div className={styles.facts}>
            <span className={styles.fact}>
              <MedalIcon size={18} aria-hidden />
              {user.level ? SKILL_LEVEL[user.level] : 'Уровень не указан'}
            </span>
            {user.age && (
              <span className={styles.fact}>
                <UserIcon size={18} aria-hidden />
                {count(user.age, YEAR_WORDS)}
              </span>
            )}
            <span className={styles.fact}>
              <CheckIcon size={18} aria-hidden />
              {attended === undefined
                ? 'Сколько встреч было: загружаем…'
                : attended === 0
                  ? 'Первая встреча на платформе'
                  : `Встреч на платформе: ${attended}`}
            </span>
            <span className={styles.fact}>
              <ClockCountdownIcon size={18} aria-hidden />
              Заявка {formatAgo(application.createdAt)}
            </span>
            <EscortMark needed={application.needsEscort} />
          </div>
        </div>
      </div>

      {application.note ? (
        <p className={styles.quote}>«{application.note}»</p>
      ) : (
        <p className={[styles.quote, styles.quoteEmpty].join(' ')}>Без сообщения</p>
      )}

      {mode === 'idle' ? (
        <div className={styles.cardActions}>
          <Button
            variant="primary"
            icon={<CheckIcon size={20} weight="bold" aria-hidden />}
            disabled={full || busy !== null}
            loading={busy === 'accept'}
            loadingText="Принимаем…"
            onClick={() => decide('accept')}
            aria-describedby={full ? fullHintId : undefined}
          >
            Принять
          </Button>
          <Button
            variant="secondary"
            icon={<XIcon size={20} weight="bold" aria-hidden />}
            disabled={busy !== null}
            onClick={() => setMode('rejecting')}
          >
            Отклонить
          </Button>
          {full && (
            <p id={fullHintId} className={styles.fullHint}>
              <InfoIcon size={18} aria-hidden />
              <span>
                Мест нет. <Link to={editLink}>Увеличьте лимит</Link> или отклоните заявку.
              </span>
            </p>
          )}
        </div>
      ) : (
        <div className={styles.reject}>
          <label htmlFor={reasonId} className={styles.rejectLabel}>
            Причина отказа, необязательно
          </label>
          <div className={styles.templates} role="group" aria-label="Готовые причины">
            {REJECT_TEMPLATES.map((t) => (
              <Chip key={t} selected={reason === t} onClick={() => setReason(reason === t ? '' : t)}>
                {t}
              </Chip>
            ))}
          </div>
          <Input.TextArea
            id={reasonId}
            rows={2}
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Например, приходите в следующую субботу: будет группа новичков"
          />
          <p className={styles.note}>
            {user.name.split(' ')[0]} увидит причину в своих занятиях и в уведомлении.
          </p>
          {owner && !application.stopListed && (
            <Checkbox checked={stopToo} onChange={(e) => setStopToo(e.target.checked)}>
              <span className={styles.checkLabel}>Больше не принимать заявки от этого человека</span>
            </Checkbox>
          )}
          <div className={styles.cardActions}>
            <Button
              variant="danger"
              icon={<XIcon size={20} weight="bold" aria-hidden />}
              loading={busy === 'reject'}
              loadingText="Отклоняем…"
              onClick={() => decide('reject')}
            >
              {stopToo && owner ? 'Отклонить и не пускать' : 'Отклонить заявку'}
            </Button>
            <Button variant="quiet" disabled={busy !== null} onClick={() => setMode('idle')}>
              Не отклонять
            </Button>
          </div>
        </div>
      )}
      {owner && (
        <StopAddDialog
          open={stopOpen}
          owner={owner}
          userId={application.userId}
          onClose={() => setStopOpen(false)}
          beforeSubmit={rejectQuietly}
          submitLabel="Отклонить и не пускать"
          exceptEventId={application.eventId}
          intro={
            <span>
              Заявку отклоним{reason.trim() ? ` с причиной «${reason.trim()}»` : ''}, затем человек попадёт в
              стоп-лист.
            </span>
          }
        />
      )}
    </article>
  );
}
