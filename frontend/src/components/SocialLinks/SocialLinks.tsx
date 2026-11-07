import styles from './SocialLinks.module.css';

export const VK_BOT_URL = 'https://vk.me/club242415813';

/** Знак ВКонтакте: в наборе Phosphor его нет. */
function VkIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden width="20" height="20" fill="currentColor">
      <path d="M12.79 17.3C6.95 17.3 3.62 13.3 3.48 6.64h2.92c.1 4.89 2.26 6.96 3.97 7.39V6.64h2.76v4.22c1.69-.18 3.46-2.1 4.06-4.22h2.75c-.46 2.6-2.38 4.52-3.74 5.3 1.36.64 3.55 2.31 4.38 5.36h-3.03c-.65-2.03-2.27-3.6-4.42-3.82v3.82h-.34Z" />
    </svg>
  );
}

/**
 * Ссылка на бота «Спорт и точка» во ВКонтакте.
 * `header` — круглые значки в шапке, `menu` — подписанные ссылки в меню на телефоне.
 */
export function SocialLinks({ variant = 'header' }: { variant?: 'header' | 'menu' }) {
  const links = [
    { href: VK_BOT_URL, label: 'Бот во ВКонтакте', short: 'VK', icon: <VkIcon />, tone: 'vk' },
  ] as const;

  return (
    <div className={variant === 'header' ? styles.header : styles.menu} role="group" aria-label="Наши боты">
      {links.map((link) => (
        <a
          key={link.href}
          href={link.href}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.link}
          data-tone={link.tone}
          aria-label={variant === 'header' ? `${link.label} (откроется в новой вкладке)` : undefined}
          title={variant === 'header' ? link.label : undefined}
        >
          <span className={styles.icon}>{link.icon}</span>
          {variant === 'menu' && <span>{link.short}</span>}
        </a>
      ))}
    </div>
  );
}
