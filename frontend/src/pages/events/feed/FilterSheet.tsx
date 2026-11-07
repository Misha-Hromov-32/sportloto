import { CaretDownIcon } from '@phosphor-icons/react';
import { Drawer, Popover } from 'antd';
import { useState, type ReactNode } from 'react';

import { Button, Chip } from '@/components';

import styles from './FeedFilters.module.css';
import { DESKTOP, useMediaQuery } from './useMediaQuery';

interface FilterSheetProps {
  label: string;
  /** Заголовок панели, например «Когда». */
  title: string;
  selected: boolean;
  icon?: ReactNode;
  children: (close: () => void) => ReactNode;
  /** Шире обычного: для дерева направлений. */
  wide?: boolean;
}

/**
 * Чип-фильтр с панелью выбора. На компьютере — всплывающая панель у чипа,
 * на телефоне — шторка снизу: в ней крупные варианты удобнее нажимать пальцем.
 */
export function FilterSheet({ label, title, selected, icon, children, wide }: FilterSheetProps) {
  const desktop = useMediaQuery(DESKTOP);
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  const trigger = (
    <span className={styles.trigger}>
      <Chip selected={selected} icon={icon} onClick={desktop ? undefined : () => setOpen(true)}>
        <span className={styles.triggerLabel}>
          {label}
          <CaretDownIcon size={14} weight="bold" aria-hidden />
        </span>
      </Chip>
    </span>
  );

  const body = (
    <div className={[styles.sheet, wide && styles.sheetWide].filter(Boolean).join(' ')}>
      {children(close)}
    </div>
  );

  if (desktop) {
    return (
      <Popover
        trigger="click"
        placement="bottomLeft"
        open={open}
        onOpenChange={setOpen}
        arrow={false}
        title={<span className={styles.sheetTitle}>{title}</span>}
        content={body}
        destroyOnHidden
      >
        {trigger}
      </Popover>
    );
  }

  return (
    <>
      {trigger}
      <Drawer
        open={open}
        onClose={close}
        placement="bottom"
        height="auto"
        title={title}
        destroyOnHidden
        className={styles.drawer}
        footer={
          <Button variant="primary" block onClick={close}>
            Готово
          </Button>
        }
      >
        {body}
      </Drawer>
    </>
  );
}
