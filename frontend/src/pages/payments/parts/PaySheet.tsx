import { Drawer, Modal } from 'antd';
import type { ReactNode } from 'react';

import { DESKTOP, useMediaQuery } from '@/pages/events/feed/useMediaQuery';

import styles from './payments.module.css';

interface PaySheetProps {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}

/** Окно оплаты: на компьютере — диалог, на телефоне — шторка снизу, кнопки у большого пальца. */
export function PaySheet({ open, title, onClose, children, footer, width = 560 }: PaySheetProps) {
  const desktop = useMediaQuery(DESKTOP);
  if (desktop) {
    return (
      <Modal
        open={open}
        onCancel={onClose}
        title={title}
        footer={footer ? <div className={styles.sheetFoot}>{footer}</div> : null}
        width={width}
        destroyOnHidden
        className={styles.modal}
      >
        {children}
      </Modal>
    );
  }
  return (
    <Drawer
      open={open}
      onClose={onClose}
      placement="bottom"
      height="auto"
      title={title}
      destroyOnHidden
      rootClassName={styles.sheet}
      footer={footer ? <div className={styles.sheetFoot}>{footer}</div> : null}
    >
      {children}
    </Drawer>
  );
}
