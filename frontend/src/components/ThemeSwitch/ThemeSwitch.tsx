import { Check, CircleHalf, Heart, Moon, Sun } from '@phosphor-icons/react';
import { Dropdown } from 'antd';
import { useState, type ReactNode } from 'react';

import { DEFAULT_SETTINGS, THEME_OPTIONS, type ThemeName } from '@/theme/settings';
import { useSettings } from '@/theme/useSettings';

import styles from './ThemeSwitch.module.css';

const ICONS: Record<ThemeName, ReactNode> = {
  light: <Sun size={20} aria-hidden />,
  dark: <Moon size={20} aria-hidden />,
  pink: <Heart size={20} aria-hidden />,
  midnight: <CircleHalf size={20} aria-hidden />,
};

/**
 * Две соседние кнопки, как в теме «Графит»: солнце открывает выбор оформления,
 * «Аа» — настройки чтения (крупный текст, простой режим, для левши), включая выход из простого режима.
 */
export function ThemeSwitch({ showLabels }: { showLabels?: boolean }) {
  const { settings, update } = useSettings();
  const [openMenu, setOpenMenu] = useState<'theme' | 'reading' | null>(null);
  const onOpenChange = (menu: 'theme' | 'reading', open: boolean) =>
    setOpenMenu((current) => (open ? menu : current === menu ? null : current));
  if (!showLabels)
    return (
      <span className={styles.compact}>
        <span className={styles.control}>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            overlayClassName={styles.popup}
            transitionName=""
            autoFocus
            open={openMenu === 'theme'}
            onOpenChange={(open) => onOpenChange('theme', open)}
            menu={{
              selectable: true,
              selectedKeys: [settings.theme],
              items: THEME_OPTIONS.map((o) => ({
                key: o.value,
                label: o.label,
                icon: settings.theme === o.value ? <Check size={18} aria-hidden /> : ICONS[o.value],
              })),
              onClick: ({ key }) => {
                const option = THEME_OPTIONS.find((o) => o.value === key);
                if (option) update({ theme: option.value });
                setOpenMenu(null);
              },
            }}
          >
            <button
              type="button"
              className={styles.trigger}
              aria-label="Выбрать оформление"
              title={`Оформление: ${THEME_OPTIONS.find((o) => o.value === settings.theme)?.label ?? ''}`}
              aria-haspopup="menu"
              aria-expanded={openMenu === 'theme'}
            >
              <Sun size={22} aria-hidden />
            </button>
          </Dropdown>
        </span>
        <span className={styles.control}>
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            overlayClassName={styles.popup}
            transitionName=""
            autoFocus
            open={openMenu === 'reading'}
            onOpenChange={(open) => onOpenChange('reading', open)}
            menu={{
              items: [
                {
                  key: 'large',
                  label: 'Крупный текст',
                  icon: settings.largeText ? <Check size={18} /> : undefined,
                },
                {
                  key: 'simple',
                  label: 'Простой режим',
                  icon: settings.simple ? <Check size={18} /> : undefined,
                },
                {
                  key: 'left',
                  label: 'Для левши',
                  icon: settings.leftHand ? <Check size={18} /> : undefined,
                },
                { type: 'divider' },
                { key: 'reset', label: 'Сбросить настройки чтения' },
              ],
              onClick: ({ key }) => {
                if (key === 'large') update({ largeText: !settings.largeText });
                else if (key === 'simple') update({ simple: !settings.simple });
                else if (key === 'left') update({ leftHand: !settings.leftHand });
                else if (key === 'reset')
                  update({
                    largeText: DEFAULT_SETTINGS.largeText,
                    simple: DEFAULT_SETTINGS.simple,
                    leftHand: DEFAULT_SETTINGS.leftHand,
                  });
                setOpenMenu(null);
              },
            }}
          >
            <button
              type="button"
              className={styles.trigger}
              aria-label="Настройки чтения"
              title="Размер текста и управление"
              aria-haspopup="menu"
              aria-expanded={openMenu === 'reading'}
            >
              Аа
            </button>
          </Dropdown>
        </span>
      </span>
    );
  return (
    <div
      className={[styles.root, showLabels && styles.labelled].filter(Boolean).join(' ')}
      role="radiogroup"
      aria-label="Тема оформления"
    >
      {THEME_OPTIONS.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={settings.theme === o.value}
          aria-label={showLabels ? undefined : `Тема: ${o.label.toLowerCase()}`}
          title={o.label}
          className={[styles.option, settings.theme === o.value && styles.active].filter(Boolean).join(' ')}
          onClick={() => update({ theme: o.value })}
        >
          {ICONS[o.value]}
          {showLabels && <span>{o.label}</span>}
        </button>
      ))}
    </div>
  );
}
