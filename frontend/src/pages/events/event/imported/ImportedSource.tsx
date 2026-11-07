import { ArrowSquareOutIcon, UsersFourIcon } from '@phosphor-icons/react';
import { useNavigate } from 'react-router';

import { Button } from '@/components';
import { COMMUNITY_API, useLiveGet, useMe } from '@/lib/api';
import type { EventSourceView } from '@/types/community';

import { EMPTY_ASSISTANT, EMPTY_VALUES, type OrgFormValues } from '../../../orgs/parts/formModel';
import styles from './imported.module.css';

/**
 * В8: встреча собрана из открытого поста сообщества. Плашка ведёт к посту, а представителю
 * сообщества предлагает забрать страницу: заявка организации открывается уже заполненной.
 */
export function ImportedSource({ eventId }: { eventId: string }) {
  const { me } = useMe();
  const navigate = useNavigate();
  const { data } = useLiveGet<{ source: EventSourceView | null }>(COMMUNITY_API.eventSource(eventId), [
    'imports',
    'events',
  ]);
  const s = data?.source;
  if (!s) return null;

  const claim = () => {
    if (!me) {
      navigate(`/login?to=${encodeURIComponent(`/events/${eventId}`)}`);
      return;
    }
    const values: OrgFormValues = {
      ...EMPTY_VALUES,
      name: s.claim.name,
      type: 'initiative',
      description: s.claim.description,
      sportIds: s.claim.sportIds,
      districtId: s.claim.districtId,
      social: s.claim.social,
    };
    try {
      localStorage.setItem(
        `vmeste.orgDraft.${me.id}`,
        JSON.stringify({ values, mode: 'manual', assistant: EMPTY_ASSISTANT }),
      );
    } catch {
      /* без хранилища заявка откроется пустой */
    }
    navigate('/org/new');
  };

  return (
    <aside className={styles.box} aria-label="Источник встречи">
      <UsersFourIcon size={24} aria-hidden className={styles.icon} />
      <div className={styles.body}>
        <p className={styles.title}>Из сообщества «{s.name}»</p>
        <p className={styles.text}>
          {s.transferred
            ? 'Встречу перенесли из открытого поста. Теперь её ведёт само сообщество.'
            : 'Встреча добавлена вручную из открытого поста. Изменения в посте не переносятся на сайт автоматически. Перед записью проверьте условия у организатора или в исходном посте.'}
        </p>
        <div className={styles.actions}>
          <a href={s.postUrl} target="_blank" rel="noreferrer noopener" className={styles.link}>
            Открыть пост
            <ArrowSquareOutIcon size={16} aria-hidden />
            <span className="sr-only">(откроется в новой вкладке)</span>
          </a>
          {!s.transferred && (
            <Button size="sm" variant="secondary" onClick={claim}>
              Это ваше сообщество? Заберите страницу
            </Button>
          )}
        </div>
      </div>
    </aside>
  );
}
