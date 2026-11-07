import type { BotPlatform } from './api';
import styles from './bots.module.css';

export function BotLogo({ platform, size = 'md' }: { platform: BotPlatform; size?: 'md' | 'lg' }) {
  return (
    <span className={[styles.logo, styles[platform], styles[size]].join(' ')} aria-hidden>
      {platform === 'vk' ? 'VK' : null}
    </span>
  );
}
