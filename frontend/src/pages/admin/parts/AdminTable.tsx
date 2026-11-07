import { Grid, Pagination, Table, type TableColumnsType } from 'antd';
import { useState, type MouseEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { SkeletonBlock } from '@/components';

import styles from './admin.module.css';

export interface AdminColumn<T> {
  key: string;
  title: string;
  render: (row: T) => ReactNode;
  width?: number | string;
  sorter?: (a: T, b: T) => number;
  defaultSortOrder?: 'ascend' | 'descend';
  /** Главная колонка: на телефоне идёт заголовком строки. */
  primary?: boolean;
  hideOnMobile?: boolean;
  align?: 'left' | 'right' | 'center';
}

interface AdminTableProps<T> {
  rows: T[];
  rowKey: (row: T) => string;
  columns: AdminColumn<T>[];
  loading?: boolean;
  empty: ReactNode;
  /** Куда ведёт строка: клик по строке открывает карточку. */
  rowLink?: (row: T) => string;
  pageSize?: number;
  caption: string;
  server?: {
    page: number; total: number; onPageChange: (page: number) => void;
    sortKey: string; sortOrder: 'asc' | 'desc'; onSortChange: (key: string, order: 'asc' | 'desc') => void;
  };
}

const INTERACTIVE = 'a, button, input, label, [role="button"], [role="checkbox"]';

/**
 * Таблица админки: на широком экране — таблица Ant Design в нашей теме,
 * на телефоне — список строк «подпись: значение», без горизонтальной прокрутки.
 */
export function AdminTable<T>({
  rows,
  rowKey,
  columns,
  loading,
  empty,
  rowLink,
  pageSize = 20,
  caption,
  server,
}: AdminTableProps<T>) {
  const screens = Grid.useBreakpoint();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const wide = screens.md ?? true;

  if (loading) {
    return (
      <div className={styles.skeletonRows} role="status" aria-live="polite">
        <span className="sr-only">Загружаем список…</span>
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className={styles.skeletonRow}>
            <SkeletonBlock height={20} width="80%" />
            <SkeletonBlock height={20} width="60%" />
            <SkeletonBlock height={20} width="50%" />
            <SkeletonBlock height={20} width="40%" />
          </div>
        ))}
      </div>
    );
  }

  if (!rows.length) return <>{empty}</>;

  if (wide) {
    const antColumns: TableColumnsType<T> = columns.map((c) => ({
      key: c.key,
      title: c.title,
      width: c.width,
      align: c.align,
      sorter: server ? Boolean(c.sorter) : c.sorter,
      sortOrder: server && c.sorter ? (server.sortKey === c.key ? (server.sortOrder === 'asc' ? 'ascend' : 'descend') : null) : undefined,
      defaultSortOrder: c.defaultSortOrder,
      showSorterTooltip: false,
      sortDirections: ['descend', 'ascend', 'descend'],
      render: (_: unknown, row: T) => c.render(row),
    }));
    return (
      <div className={styles.tableCard}>
        <Table<T>
          className={styles.table}
          columns={antColumns}
          dataSource={rows}
          rowKey={rowKey}
          size="middle"
          pagination={
            server
              ? { current: server.page, total: server.total, pageSize, onChange: server.onPageChange,
                  showSizeChanger: false, hideOnSinglePage: true, position: ['bottomCenter'] }
              : rows.length > pageSize
              ? { pageSize, showSizeChanger: false, hideOnSinglePage: true, position: ['bottomCenter'] }
              : false
          }
          onChange={(_pagination, _filters, sorting, extra) => {
            if (server && extra.action === 'sort') {
              const sort = Array.isArray(sorting) ? sorting[0] : sorting;
              if (sort?.columnKey) server.onSortChange(String(sort.columnKey), sort.order === 'ascend' ? 'asc' : 'desc');
            }
          }}
          rowClassName={rowLink ? styles.clickRow : undefined}
          onRow={(row) =>
            rowLink
              ? {
                  onClick: (e: MouseEvent<HTMLElement>) => {
                    if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
                    navigate(rowLink(row));
                  },
                }
              : {}
          }
          aria-label={caption}
        />
      </div>
    );
  }

  const primary = columns.find((c) => c.primary) ?? columns[0];
  const rest = columns.filter((c) => c !== primary && !c.hideOnMobile);
  const shown = server ? rows : rows.slice((page - 1) * pageSize, page * pageSize);

  return (
    <>
      <ul className={styles.mobileList} aria-label={caption}>
        {shown.map((row) => (
          <li key={rowKey(row)} className={styles.mobileItem}>
            {primary && <div className={styles.mobilePrimary}>{primary.render(row)}</div>}
            <dl className={styles.mobileMeta}>
              {rest.map((c) => (
                <div key={c.key} className={styles.metaPair}>
                  <dt>{c.title}</dt>
                  <dd>{c.render(row)}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
      {(server ? server.total : rows.length) > pageSize && (
        <div className={styles.pager}>
          <Pagination
            current={server?.page ?? page}
            pageSize={pageSize}
            total={server?.total ?? rows.length}
            onChange={server?.onPageChange ?? setPage}
            showSizeChanger={false}
            simple
          />
        </div>
      )}
    </>
  );
}
