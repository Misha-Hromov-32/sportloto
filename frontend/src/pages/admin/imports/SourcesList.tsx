import { ArrowSquareOutIcon, CheckCircleIcon, HourglassIcon, ShareFatIcon } from '@phosphor-icons/react';
import { App } from 'antd';
import { Link } from 'react-router';

import { Button, EmptyState } from '@/components';
import { COMMUNITY_API, useAction } from '@/lib/api';
import type { CommunitySourceView } from '@/types/community';

import { StatusPill } from './ImportCard';
import styles from './imports.module.css';

export function SourcesList({ sources }: { sources: CommunitySourceView[] }) {
  const { run, isPending } = useAction<{ moved: number }>();
  const { modal } = App.useApp();

  if (!sources.length)
    return (
      <EmptyState title="Сообществ пока нет">
        Загрузите выгрузку постов: сообщество появится здесь вместе с его черновиками.
      </EmptyState>
    );

  const transfer = (s: CommunitySourceView, orgId: string, orgName: string) =>
    modal.confirm({
      title: `Передать встречи «${orgName}»?`,
      content:
        'Все встречи, опубликованные из постов этого сообщества, перейдут организации. Записавшиеся останутся, заявки и вопросы будут приходить её представителю. Отменить передачу нельзя.',
      okText: 'Передать встречи',
      cancelText: 'Не сейчас',
      onOk: () => run(COMMUNITY_API.transferSource(s.id), { orgId }, { success: 'Встречи переданы сообществу' }),
    });

  return (
    <ul className={styles.sources}>
      {sources.map((s) => (
        <li key={s.id} className={styles.sourceCard}>
          <h3 className={styles.sourceName}>{s.name}</h3>
          <a href={s.url} target="_blank" rel="noreferrer noopener" className={styles.source}>
            {s.url.replace(/^https?:\/\//, '')}
            <ArrowSquareOutIcon size={16} aria-hidden />
            <span className="sr-only">(откроется в новой вкладке)</span>
          </a>
          <p className={styles.counts}>
            Постов: {s.posts}. Опубликовано: {s.published}. Ждут решения: {s.drafts}.
          </p>
          {s.orgId && !s.transferredTo && (
            <p className={styles.hint}>
              <Link to={`/orgs/${s.orgId}`}>Страница сообщества на платформе</Link>
            </p>
          )}
          {s.transferredTo ? (
            <StatusPill tone="ok" icon={<CheckCircleIcon size={18} weight="bold" aria-hidden />}>
              Страницу забрало: {s.transferredName}
            </StatusPill>
          ) : s.claims.length ? (
            <ul className={styles.claims} aria-label="Кто хочет забрать страницу">
              {s.claims.map((c) => (
                <li key={c.orgId} className={styles.claim}>
                  <span>
                    <Link to={`/admin/organizations/${c.orgId}`}>{c.name}</Link> указали это сообщество в заявке
                  </span>
                  {c.approved ? (
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<ShareFatIcon size={18} aria-hidden />}
                      disabled={isPending || s.published === 0}
                      onClick={() => transfer(s, c.orgId, c.name)}
                    >
                      Передать встречи
                    </Button>
                  ) : (
                    <StatusPill tone="wait" icon={<HourglassIcon size={18} weight="bold" aria-hidden />}>
                      Сначала допустите организацию
                    </StatusPill>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={styles.hint}>
              Никто не забирал страницу. На карточках встреч есть кнопка «Это ваше сообщество? Заберите страницу».
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
