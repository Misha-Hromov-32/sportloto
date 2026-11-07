import { CheckIcon, LinkSimpleIcon, ShieldCheckIcon } from '@phosphor-icons/react';
import { useList } from '@refinedev/core';
import { App } from 'antd';
import { useEffect } from 'react';
import { Link, useLocation } from 'react-router';

import { EmptyState, ErrorState, SkeletonBlock, SkeletonText } from '@/components';
import { count } from '@/lib/plural';
import type { PlatformRule } from '@/types/api';

import styles from './parts/Rules.module.css';
import { PersonalPage } from '../shared/PersonalPage';

const RULE_WORDS = ['правило', 'правила', 'правил'] as const;

const CONSEQUENCES = [
  'Сообщение в обсуждении скрывают. Автор видит, какое правило нарушено.',
  'Событие снимают с публикации: записаться на него больше нельзя. Организатор и записавшиеся видят причину и пункт правил.',
  'Заявку организации отклоняют или возвращают на доработку с объяснением, что исправить.',
];

export default function RulesPage() {
  const { hash } = useLocation();
  const { message } = App.useApp();
  const { result, query } = useList<PlatformRule>({
    resource: 'rules',
    sorters: [{ field: 'number', order: 'asc' }],
    pagination: { mode: 'off' },
  });
  const rules = result.data ?? [];

  useEffect(() => {
    if (!hash || query.isLoading) return;
    const el = document.getElementById(decodeURIComponent(hash.slice(1)));
    if (el) {
      el.scrollIntoView({ block: 'start' });
      el.focus({ preventScroll: true });
    }
  }, [hash, query.isLoading]);

  const copyLink = async (rule: PlatformRule) => {
    const url = `${window.location.origin}/rules#${rule.id}`;
    try {
      await navigator.clipboard.writeText(url);
      message.success(`Ссылка на правило ${rule.number} скопирована`);
    } catch {
      message.info(`Ссылка на правило: ${url}`);
    }
  };

  return (
    <PersonalPage
      title="Правила сайта"
      icon={<ShieldCheckIcon size={28} />}
      summary={
        <>
          <strong>Участие и публикация</strong>Правила для участников, организаторов и клубов.
        </>
      }
      description={
        <>
          {rules.length
            ? `${count(rules.length, RULE_WORDS)} об участии и публикации встреч. `
            : 'Правила участия и публикации встреч.'}
          Если событие сняли с публикации или скрыли сообщение, в причине будет ссылка на нарушенный пункт.
        </>
      }
    >
      {query.isError ? (
        <ErrorState title="Не удалось загрузить правила" onRetry={() => void query.refetch()}>
          Проверьте интернет и нажмите «Повторить».
        </ErrorState>
      ) : query.isLoading ? (
        <div className={styles.layout} role="status" aria-label="Загружаем правила">
          <div className={styles.toc} aria-hidden>
            <SkeletonText lines={6} />
          </div>
          <div className={styles.list} aria-hidden>
            {[0, 1, 2].map((i) => (
              <div key={i} className={styles.rule}>
                <SkeletonBlock width={48} height={48} />
                <div className={styles.ruleBody}>
                  <SkeletonBlock width="60%" height={24} />
                  <SkeletonText lines={2} />
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : rules.length === 0 ? (
        <EmptyState title="Правила пока не опубликованы">
          Администратор добавит их в ближайшее время.
        </EmptyState>
      ) : (
        <div className={styles.layout}>
          <nav className={styles.toc} aria-label="Оглавление правил">
            <h2 className={styles.tocTitle}>Оглавление</h2>
            <ol className={styles.tocList}>
              {rules.map((r) => (
                <li key={r.id}>
                  <a href={`#${r.id}`} aria-current={hash === `#${r.id}` ? 'location' : undefined}>
                    <span className={styles.tocNum}>{r.number}</span>
                    {r.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <div className={styles.list}>
            {rules.map((r) => (
              <article
                key={r.id}
                id={r.id}
                tabIndex={-1}
                data-target={hash === `#${r.id}` || undefined}
                className={styles.rule}
                aria-labelledby={`${r.id}-title`}
              >
                <span className={styles.ruleNum} aria-hidden>
                  {r.number}
                </span>
                <div className={styles.ruleBody}>
                  <h2 id={`${r.id}-title`} className={styles.ruleTitle}>
                    <span className="sr-only">Правило {r.number}. </span>
                    {r.title}
                  </h2>
                  <p className={styles.ruleText}>{r.text}</p>
                  <button type="button" className={styles.copy} onClick={() => void copyLink(r)}>
                    <LinkSimpleIcon size={18} aria-hidden />
                    Скопировать ссылку на правило
                  </button>
                </div>
              </article>
            ))}

            <section className={styles.after} aria-labelledby="after-title">
              <h2 id="after-title" className={styles.afterTitle}>
                Что бывает при нарушении
              </h2>
              <ul className={styles.afterList}>
                {CONSEQUENCES.map((c) => (
                  <li key={c}>
                    <span className={styles.afterIcon} aria-hidden>
                      <CheckIcon size={14} weight="bold" />
                    </span>
                    {c}
                  </li>
                ))}
              </ul>
              <p className={styles.afterNote}>
                Решение принимает администратор, помощник только подсказывает. Причина и пункт правил указаны
                в уведомлении о решении.
              </p>
              <Link className={styles.mail} to="/notifications">
                Открыть уведомления
              </Link>
            </section>
          </div>
        </div>
      )}
    </PersonalPage>
  );
}
