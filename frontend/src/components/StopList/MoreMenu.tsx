import { DotsThreeIcon } from '@phosphor-icons/react';
import { Dropdown } from 'antd';
import type { ReactNode } from 'react';

import styles from './StopList.module.css';

export interface MoreMenuItem {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
}

/** Кнопка «⋯» с меню действий над человеком. Открывается с клавиатуры, стрелки ходят по пунктам. */
export function MoreMenu({
  label,
  items,
  onSelect,
  className,
}: {
  label: string;
  /** Вид кнопки по месту: например, как соседние действия под сообщением. */
  className?: string;
  items: MoreMenuItem[];
  onSelect: (key: string) => void;
}) {
  if (!items.length) return null;
  return (
    <Dropdown
      trigger={['click']}
      placement="bottomRight"
      autoFocus
      menu={{
        items: items.map((i) => ({ key: i.key, label: i.label, icon: i.icon, danger: i.danger })),
        onClick: ({ key }) => onSelect(key),
      }}
    >
      <button
        type="button"
        className={className ?? styles.more}
        aria-label={label}
        title={label}
        aria-haspopup="menu"
      >
        <DotsThreeIcon size={24} weight="bold" aria-hidden />
      </button>
    </Dropdown>
  );
}
