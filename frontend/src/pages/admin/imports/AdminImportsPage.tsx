import { useList } from '@refinedev/core';
import { Segmented } from 'antd';
import { useMemo } from 'react';

import { EmptyState, ErrorState, PageHeader, SkeletonBlock, SkeletonText } from '@/components';
import { useLiveRefetch } from '@/lib/api';
import type { SportView } from '@/types/api';
import type { CommunitySourceView, ImportedPostView } from '@/types/community';
import type { District } from '@/types/domain';

import adminStyles from '../parts/admin.module.css';
import { useUrlParams } from '../parts/hooks';
import { ImportCard } from './ImportCard';
import styles from './imports.module.css';
import { SourcesList } from './SourcesList';
import { UploadPanel } from './UploadPanel';

type Tab = 'draft' | 'published' | 'rejected' | 'sources';
const TABS: Tab[] = ['draft', 'published', 'rejected', 'sources'];

const EMPTY: Record<Exclude<Tab, 'sources'>, { title: string; text: string }> = {
  draft: {
    title: 'Новых постов нет',
    text: 'Загрузите выгрузку постов сообщества. Помощник разберёт их в черновики встреч, и они появятся здесь.',
  },
  published: {
    title: 'Опубликованных пока нет',
    text: 'Проверьте черновик и нажмите «Опубликовать от имени сообщества».',
  },
  rejected: {
    title: 'Отклонённых нет',
    text: 'Сюда попадают посты, которые не подошли: объявления, отчёты, опросы.',
  },
};

export default function AdminImportsPage() {
  const [params, setParams] = useUrlParams({ tab: 'draft' });
  const tab = (TABS.includes(params.tab as Tab) ? params.tab : 'draft') as Tab;

  const { result, query } = useList<ImportedPostView>({
    resource: 'community-imports',
    filters: [{ field: 'status', operator: 'eq', value: 'all' }],
    pagination: { mode: 'off' },
  });
  const { result: sourcesRes, query: sourcesQuery } = useList<CommunitySourceView>({
    resource: 'community-sources',
    pagination: { mode: 'off' },
  });
  const { result: sportsRes } = useList<SportView>({ resource: 'sports', pagination: { mode: 'off' } });
  const { result: districtsRes } = useList<District>({ resource: 'districts', pagination: { mode: 'off' } });
  const refetch = () => {
    void query.refetch();
    void sourcesQuery.refetch();
  };
  useLiveRefetch(['imports', 'events', 'organizations', 'demo'], refetch);

  const all = useMemo(() => result?.data ?? [], [result]);
  const counts = {
    draft: all.filter((p) => p.status === 'draft').length,
    published: all.filter((p) => p.status === 'published').length,
    rejected: all.filter((p) => p.status === 'rejected').length,
    sources: sourcesRes?.data.length ?? 0,
  };
  const rows = tab === 'sources' ? [] : all.filter((p) => p.status === tab);

  return (
    <div className={adminStyles.page}>
      <PageHeader
        title="Из сообществ"
        subtitle="Загрузите файл или вставьте текст постов. Проверьте даты, места и условия перед публикацией. Изменения в сообществе не обновляют эти встречи автоматически."
      />

      <UploadPanel onUploaded={refetch} />

      <Segmented<Tab>
        value={tab}
        onChange={(value) => setParams({ tab: value })}
        options={[
          { value: 'draft', label: `Ждут решения (${counts.draft})` },
          { value: 'published', label: `Опубликованы (${counts.published})` },
          { value: 'rejected', label: `Отклонены (${counts.rejected})` },
          { value: 'sources', label: `Сообщества (${counts.sources})` },
        ]}
      />

      {query.isError ? (
        <ErrorState title="Не удалось загрузить посты" onRetry={() => void query.refetch()}>
          Возможно, вы вышли из аккаунта администратора. Обновите страницу.
        </ErrorState>
      ) : query.isLoading ? (
        <ul className={styles.list} aria-busy="true">
          {Array.from({ length: 3 }, (_, i) => (
            <li key={i} className={styles.card}>
              <SkeletonText lines={4} />
              <div className={styles.draft}>
                <SkeletonBlock height={24} width="70%" />
                <SkeletonBlock height={24} width="50%" />
                <SkeletonBlock height={44} width={220} />
              </div>
            </li>
          ))}
        </ul>
      ) : tab === 'sources' ? (
        <SourcesList sources={sourcesRes?.data ?? []} />
      ) : rows.length === 0 ? (
        <EmptyState title={EMPTY[tab].title}>{EMPTY[tab].text}</EmptyState>
      ) : (
        <ul className={styles.list}>
          {rows.map((p) => (
            <ImportCard
              key={p.id}
              post={p}
              sports={sportsRes?.data ?? []}
              districts={districtsRes?.data ?? []}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
