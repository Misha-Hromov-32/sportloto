import { ArrowCounterClockwiseIcon, ArrowLeftIcon, UsersIcon } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';

import { Button } from '@/components';

import { summaryLine } from './reviewModel';
import styles from './review.module.css';

interface ReviewSummaryProps {
  accepted: number;
  rejected: number;
  later: number;
  /** «К участникам» — только в стопке одного события. */
  participantsTo?: string;
  exitLabel: string;
  onExit: () => void;
  onReopenLater: () => void;
}

/** Итог стопки заявок: сколько принято, отклонено и отложено, и куда дальше. */
export function ReviewSummary({
  accepted,
  rejected,
  later,
  participantsTo,
  exitLabel,
  onExit,
  onReopenLater,
}: ReviewSummaryProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className={styles.summary} aria-labelledby="review-summary-title">
      <h2 ref={headingRef} id="review-summary-title" className={styles.summaryTitle} tabIndex={-1}>
        {later > 0 ? 'Остались только отложенные' : 'Все заявки разобраны'}
      </h2>
      <p className={styles.summaryText}>{summaryLine(accepted, rejected, later)}.</p>
      {accepted + rejected > 0 && <p className={styles.summaryNote}>Люди получат ответ в уведомлениях.</p>}
      <div className={styles.summaryActions}>
        {later > 0 && (
          <Button
            variant="primary"
            icon={<ArrowCounterClockwiseIcon size={20} aria-hidden />}
            onClick={onReopenLater}
          >
            Вернуться к отложенным ({later})
          </Button>
        )}
        {participantsTo && (
          <Button
            variant={later > 0 ? 'secondary' : 'primary'}
            icon={<UsersIcon size={20} aria-hidden />}
            to={participantsTo}
            replace
          >
            К участникам
          </Button>
        )}
        <Button variant="secondary" icon={<ArrowLeftIcon size={20} aria-hidden />} onClick={onExit}>
          {exitLabel}
        </Button>
      </div>
    </section>
  );
}
