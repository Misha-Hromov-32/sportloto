import {
  ArrowCounterClockwiseIcon,
  BellIcon,
  Check,
  PaletteIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  TextAaIcon,
  UserCircleMinusIcon,
} from '@phosphor-icons/react';
import { Switch } from 'antd';
import { useId, type ReactNode } from 'react';

import { Button } from '@/components';
import { DEFAULT_SETTINGS, THEME_OPTIONS, type UiSettings } from '@/theme/settings';
import { useSettings } from '@/theme/useSettings';

import styles from './SettingsPage.module.css';
import { PersonalPage } from '../shared/PersonalPage';
import { DeleteAccountSection } from './account/DeleteAccountSection';
import { useAiFeature } from '@/lib/aiFeatures';

import { AssistantEntry, AssistantEntryIcon } from './assistant/AssistantEntry';
import { BotsSection, BotsSectionIcon } from './bots/BotsSection';
import { DigestSection } from './digest/DigestSection';
import { NotificationChannels } from './NotificationChannels';
import { useHashAnchor } from './useHashAnchor';

function SettingsSection({
  id,
  title,
  icon,
  children,
}: {
  id: string;
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className={styles.panel} aria-labelledby={`${id}-title`}>
      <header className={styles.sectionHead}>
        <span className={styles.sectionIcon}>{icon}</span>
        <h2 id={`${id}-title`}>{title}</h2>
      </header>
      {children}
    </section>
  );
}

function ToggleRow({
  title,
  text,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  text: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className={styles.toggle}>
      <div className={styles.toggleText}>
        <span id={`${id}-title`} className={styles.toggleTitle}>
          {title}
        </span>
        <span id={`${id}-text`} className={styles.toggleHint}>
          {text}
        </span>
      </div>
      <Switch
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-text`}
      />
    </div>
  );
}

/** Мини-превью темы: настоящие токены темы через data-theme на обёртке, без отдельных цветов. */
function ThemePreview({ theme }: { theme: UiSettings['theme'] }) {
  return (
    <span className={styles.preview} data-theme={theme} aria-hidden>
      <span className={styles.previewCard}>
        <span className={styles.previewDate}>25</span>
        <span className={styles.previewLines}>
          <span className={styles.previewLine} />
          <span className={styles.previewLineShort} />
        </span>
      </span>
      <span className={styles.previewButton}>Записаться</span>
    </span>
  );
}

export default function SettingsPage() {
  const { settings, update } = useSettings();
  const mcpOn = useAiFeature('mcp');
  useHashAnchor();
  const notify = (patch: Partial<UiSettings['notify']>) =>
    update({ notify: { ...settings.notify, ...patch } });

  return (
    <PersonalPage
      title="Настройки"
      description="Тема оформления, размер текста и уведомления на сайте."
      icon={<SlidersHorizontalIcon size={28} />}
      summary={
        <>
          <strong>Сохранять не нужно</strong>Изменения применяются сразу и действуют на этом устройстве.
        </>
      }
    >
      <div className={styles.layout}>
        <div className={styles.main}>
          <SettingsSection
            id="settings-appearance"
            title="Оформление"
            icon={<PaletteIcon size={23} aria-hidden />}
          >
            <p className={styles.sectionIntro}>Тема применяется сразу, перезагружать страницу не нужно.</p>
            <div className={styles.themes} role="radiogroup" aria-label="Тема оформления">
              {THEME_OPTIONS.map((o) => {
                const active = settings.theme === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={[styles.theme, active && styles.themeActive].filter(Boolean).join(' ')}
                    onClick={() => update({ theme: o.value })}
                  >
                    <ThemePreview theme={o.value} />
                    <span className={styles.themeText}>
                      <span className={styles.themeName}>
                        {active && <Check size={18} weight="bold" aria-hidden />}
                        {o.label}
                      </span>
                      <span className={styles.themeHint}>{o.hint}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </SettingsSection>

          <SettingsSection
            id="settings-reading"
            title="Чтение и управление"
            icon={<TextAaIcon size={23} aria-hidden />}
          >
            <div className={styles.toggles}>
              <ToggleRow
                title="Крупный текст"
                text="Весь текст и кнопки становятся крупнее. Удобно, если мелкий шрифт приходится разглядывать."
                checked={settings.largeText}
                onChange={(v) => update({ largeText: v })}
              />
              <ToggleRow
                title="Простой режим"
                text="В меню остаются поиск встреч, раздел «Ищу компанию» и создание встречи. Остальные разделы доступны из меню аккаунта."
                checked={settings.simple}
                onChange={(v) => update({ simple: v })}
              />
              <ToggleRow
                title="Для левши"
                text="На телефоне кнопка «Создать» и плавающие кнопки переезжают на левую сторону."
                checked={settings.leftHand}
                onChange={(v) => update({ leftHand: v })}
              />
            </div>
          </SettingsSection>

          <SettingsSection
            id="settings-notifications"
            title="Уведомления"
            icon={<BellIcon size={23} aria-hidden />}
          >
            <NotificationChannels />
            <p className={styles.note}>
              Ответы на ваши заявки, приглашения и решения по вашей организации приходят всегда. Ниже можно
              выбрать, о чём ещё сообщать сразу, пока вы на сайте.
            </p>
            <div className={styles.toggles}>
              <ToggleRow
                title="Всплывающие сообщения"
                text="Короткое сообщение в углу экрана, когда приходит новое уведомление."
                checked={settings.notify.popups}
                onChange={(v) => notify({ popups: v })}
              />
              <ToggleRow
                title="Заявки и записи на мои события"
                text="Кто записался, отправил заявку или отменил запись."
                checked={settings.notify.applications}
                onChange={(v) => notify({ applications: v })}
                disabled={!settings.notify.popups}
              />
              <ToggleRow
                title="Изменения и отмены"
                text="Перенос времени, смена места, отмена или снятие события."
                checked={settings.notify.changes}
                onChange={(v) => notify({ changes: v })}
                disabled={!settings.notify.popups}
              />
              <ToggleRow
                title="Обсуждения"
                text="Новые вопросы к вашим событиям и ответы на ваши сообщения."
                checked={settings.notify.answers}
                onChange={(v) => notify({ answers: v })}
                disabled={!settings.notify.popups}
              />
            </div>
            <p className={styles.note}>
              Все уведомления остаются в разделе «Уведомления», даже если всплывающие сообщения выключены.
            </p>
          </SettingsSection>

          <SettingsSection
            id="settings-digest"
            title="Подборка дня"
            icon={<SparkleIcon size={23} aria-hidden />}
          >
            <DigestSection />
          </SettingsSection>

          <SettingsSection id="settings-messengers" title="Мессенджеры" icon={<BotsSectionIcon />}>
            <BotsSection />
          </SettingsSection>

          {mcpOn && (
            <SettingsSection
              id="settings-assistant"
              title="Подключить ассистента"
              icon={<AssistantEntryIcon />}
            >
              <AssistantEntry />
            </SettingsSection>
          )}

          <SettingsSection
            id="settings-account"
            title="Удалить аккаунт"
            icon={<UserCircleMinusIcon size={23} aria-hidden />}
          >
            <DeleteAccountSection />
          </SettingsSection>
        </div>
        <aside className={styles.side}>
          <nav className={styles.contents} aria-label="Разделы настроек">
            <p className={styles.eyebrow}>Разделы</p>
            <a href="#settings-appearance">
              <PaletteIcon size={20} aria-hidden />
              Оформление
            </a>
            <a href="#settings-reading">
              <TextAaIcon size={20} aria-hidden />
              Чтение и управление
            </a>
            <a href="#settings-notifications">
              <BellIcon size={20} aria-hidden />
              Уведомления
            </a>
            <a href="#settings-digest">
              <SparkleIcon size={20} aria-hidden />
              Подборка дня
            </a>
            <a href="#settings-messengers">
              <BotsSectionIcon />
              Мессенджеры
            </a>
            {mcpOn && (
              <a href="#settings-assistant">
                <AssistantEntryIcon />
                Подключить ассистента
              </a>
            )}
            <a href="#settings-account">
              <UserCircleMinusIcon size={20} aria-hidden />
              Удалить аккаунт
            </a>
          </nav>
          <div className={styles.reset}>
            <p>Вернуть тему, размер текста и уведомления к исходным.</p>
            <Button
              variant="quiet"
              icon={<ArrowCounterClockwiseIcon size={18} aria-hidden />}
              onClick={() => update(DEFAULT_SETTINGS)}
            >
              Сбросить настройки
            </Button>
          </div>
        </aside>
      </div>
    </PersonalPage>
  );
}
