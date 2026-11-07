import { FunnelSimpleIcon } from '@phosphor-icons/react';
import { Grid } from 'antd';
import { useId, useState, type ReactNode } from 'react';

import { Button } from '@/components';

import styles from './admin.module.css';

/**
 * Панель фильтров списка. На телефоне поиск виден всегда, остальное раскрывается кнопкой,
 * чтобы список начинался на первом экране.
 */
export function Filters({
  search,
  active,
  children,
}: {
  search: ReactNode;
  active: number;
  children: ReactNode;
}) {
  const screens = Grid.useBreakpoint();
  const wide = screens.md ?? true;
  const [open, setOpen] = useState(false);
  const id = useId();

  if (wide) {
    return (
      <div className={styles.toolbar}>
        {search}
        {children}
      </div>
    );
  }

  return (
    <div className={styles.toolbar}>
      {search}
      <Button
        variant="secondary"
        size="sm"
        icon={<FunnelSimpleIcon size={18} aria-hidden />}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? `Фильтры (${active})` : 'Фильтры'}
      </Button>
      {open && (
        <div id={id} className={[styles.toolbar, styles.filtersMore].join(' ')}>
          {children}
        </div>
      )}
    </div>
  );
}
