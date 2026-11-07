import { BuildingsIcon, CardsIcon, ListBulletsIcon, MapTrifoldIcon } from '@phosphor-icons/react';
import { Segmented } from 'antd';
import styles from './ViewSwitch.module.css';

/** В4: третий режим «Площадки» — площадки города и их свободные окна. «По одной» — стопка карточек. */
export type FeedView = 'list' | 'map' | 'venues' | 'cards';

export function ViewSwitch({ value, onChange }: { value: FeedView; onChange: (v: FeedView) => void }) {
  return (
    <Segmented<FeedView>
      className={styles.switch}
      aria-label="Что показать"
      value={value}
      onChange={onChange}
      options={[
        { value: 'list', label: 'Список', icon: <ListBulletsIcon size={18} aria-hidden /> },
        { value: 'map', label: 'Карта', icon: <MapTrifoldIcon size={18} aria-hidden /> },
        { value: 'venues', label: 'Площадки', icon: <BuildingsIcon size={18} aria-hidden /> },
        { value: 'cards', label: 'По одной', icon: <CardsIcon size={18} aria-hidden /> },
      ]}
    />
  );
}
