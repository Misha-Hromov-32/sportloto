import { MinusIcon, PlusIcon } from '@phosphor-icons/react';
import { useId, useState } from 'react';

import { useAction } from '@/lib/api';
import { formatRub } from '@/lib/money';
import { DEFAULT_PAYMENT_SETTINGS, PAYMENTS_API } from '@/lib/payments';
import { count, WORDS } from '@/lib/plural';
import { PayDialog } from '@/pages/payments/parts/PayDialog';
import type { ShelfItemView } from '@/types/inventory';
import type { OrderView } from '@/types/payments';

import styles from './orders.module.css';

const HOLD = DEFAULT_PAYMENT_SETTINGS.holdMinutes;

function BuyNote() {
  return (
    <>
      <p>
        Вещь отложим на {count(HOLD, WORDS.minute)}, пока вы платите. Деньги получит продавец, когда вы
        заберёте вещь и нажмёте «Получил».
      </p>
      <p>Если передумаете до передачи, вернём всё вместе со сбором.</p>
    </>
  );
}

/** Покупка вещи с полки: количество, способ оплаты, сумма; заказ оформляется перед оплатой. */
export function BuyDialog({ item, onClose }: { item: ShelfItemView | null; onClose: () => void }) {
  const [quantity, setQuantity] = useState(1);
  const { run } = useAction<OrderView>();
  const qtyId = useId();
  const max = Math.max(1, item?.available ?? 1);
  const price = item?.sale?.price ?? 0;

  const prepare = async () => {
    const order = (await run(
      PAYMENTS_API.buy(item!.id),
      { quantity },
      { silent: true },
    )) as unknown as OrderView;
    return order.id;
  };

  return (
    <PayDialog
      open={Boolean(item)}
      onClose={() => {
        setQuantity(1);
        onClose();
      }}
      kind="item_order"
      quoteTargetId={item?.id ?? ''}
      quantity={quantity}
      title="Покупка"
      what={item?.name ?? ''}
      when={item ? `${formatRub(price)} за штуку, продавец: ${item.ownerView.name}` : undefined}
      prepare={prepare}
      before={
        max > 1 ? (
          <div className={styles.qty}>
            <span id={qtyId} className={styles.qtyLabel}>
              Сколько штук
            </span>
            <div className={styles.qtyControl} role="group" aria-labelledby={qtyId}>
              <button
                type="button"
                className={styles.qtyBtn}
                aria-label="Меньше"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                <MinusIcon size={20} weight="bold" aria-hidden />
              </button>
              <output className={styles.qtyValue} aria-live="polite">
                {quantity}
              </output>
              <button
                type="button"
                className={styles.qtyBtn}
                aria-label="Больше"
                disabled={quantity >= max}
                onClick={() => setQuantity((q) => Math.min(max, q + 1))}
              >
                <PlusIcon size={20} weight="bold" aria-hidden />
              </button>
            </div>
            <span className={styles.muted}>В наличии: {max}</span>
          </div>
        ) : undefined
      }
      note={<BuyNote />}
    />
  );
}

/** Оплатить уже оформленный заказ (например, вернулись из банка без оплаты). */
export function OrderPayDialog({
  order,
  open,
  onClose,
}: {
  order: OrderView;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <PayDialog
      open={open}
      onClose={onClose}
      kind="item_order"
      quoteTargetId={order.itemId}
      quantity={order.quantity}
      paymentTargetId={order.id}
      title="Оплата покупки"
      what={order.itemName}
      when={`${count(order.quantity, ['штука', 'штуки', 'штук'])}, продавец: ${order.sellerView.name}`}
      note={<BuyNote />}
    />
  );
}
