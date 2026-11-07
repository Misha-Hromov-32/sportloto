import { PauseIcon, PlayIcon } from '@phosphor-icons/react';

import styles from './Landing.module.css';
import { setMarqueePaused, useMarqueePaused } from './marqueeStore';

/** Кнопка паузы лент на главной; таких кнопок несколько, состояние общее (marqueeStore). */
export function MarqueePauseButton() {
  const isPaused = useMarqueePaused();
  return (
    <button
      type="button"
      className={styles['round-btn']}
      aria-pressed={isPaused}
      aria-label={isPaused ? 'Запустить прокрутку лент' : 'Остановить прокрутку лент'}
      title={isPaused ? 'Запустить прокрутку' : 'Остановить прокрутку'}
      onClick={() => setMarqueePaused(!isPaused)}
    >
      {isPaused ? <PlayIcon size={22} aria-hidden /> : <PauseIcon size={22} aria-hidden />}
    </button>
  );
}
