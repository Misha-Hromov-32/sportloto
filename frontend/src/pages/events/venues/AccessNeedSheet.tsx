import { ElevatorIcon, HandHeartIcon, ToiletIcon, WheelchairIcon, type Icon } from '@phosphor-icons/react';

import { Button, Chip } from '@/components';
import { ACCESS_NEEDS } from '@/lib/venues';
import type { AccessNeed } from '@/types/domain';

import feedStyles from '../feed/FeedFilters.module.css';
import { accessLabel } from '../feed/filters';
import { FilterSheet } from '../feed/FilterSheet';
import styles from './VenuesMode.module.css';

const NEED_ICON: Record<AccessNeed, Icon> = {
  ramp: WheelchairIcon,
  elevator: ElevatorIcon,
  accessibleToilet: ToiletIcon,
  escort: HandHeartIcon,
};

const NEED_TEXT: Record<AccessNeed, string> = {
  ramp: 'Пандус или вход без ступенек',
  elevator: 'Лифт',
  accessibleToilet: 'Туалет для маломобильных',
  escort: 'Встретят и проводят',
};

/** Н1: фильтр ленты «Нужна доступная среда». Условия берутся от площадки и от организатора. */
export function AccessNeedSheet({ value, onChange }: { value: AccessNeed[]; onChange: (next: AccessNeed[]) => void }) {
  const toggle = (n: AccessNeed) => onChange(value.includes(n) ? value.filter((x) => x !== n) : [...value, n]);
  return (
    <FilterSheet
      label={accessLabel(value)}
      title="Нужна доступная среда"
      selected={value.length > 0}
      icon={<WheelchairIcon size={18} aria-hidden />}
    >
      {() => (
        <div className={styles.needs}>
          <p className={feedStyles.sheetNote}>
            Покажем встречи, где есть всё отмеченное. Условия указывают площадка и организатор.
          </p>
          <div className={styles.needChips} role="group" aria-label="Что нужно">
            {ACCESS_NEEDS.map((n) => {
              const I = NEED_ICON[n];
              return (
                <Chip key={n} selected={value.includes(n)} icon={<I size={18} aria-hidden />} onClick={() => toggle(n)}>
                  {NEED_TEXT[n]}
                </Chip>
              );
            })}
          </div>
          {value.length > 0 && (
            <Button variant="quiet" size="sm" onClick={() => onChange([])}>
              Снять выбор
            </Button>
          )}
        </div>
      )}
    </FilterSheet>
  );
}
