import { AtIcon, GlobeIcon, MapPinIcon, PhoneIcon } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

import { Section, SportIcon } from '@/components';
import type { SportView } from '@/types/api';

import { socialHref, socialLabel } from './formModel';
import styles from './OrgInfo.module.css';

/** Блок страницы организации: на странице — раздел с чертой, в предпросмотре — компактный заголовок. */
function Block({
  title,
  compact,
  children,
  id,
}: {
  title: string;
  compact?: boolean;
  children: ReactNode;
  id?: string;
}) {
  if (!compact)
    return (
      <Section title={title} id={id}>
        {children}
      </Section>
    );
  return (
    <section className={styles.compact}>
      <h3 className={styles.compactTitle}>{title}</h3>
      {children}
    </section>
  );
}

export function OrgDescription({ title, text, compact }: { title: string; text: string; compact?: boolean }) {
  return (
    <Block title={title} compact={compact} id={compact ? undefined : 'about'}>
      {text.trim() ? (
        <p className={styles.description}>{text}</p>
      ) : (
        <p className={styles.placeholder}>Расскажите, чем вы занимаетесь</p>
      )}
    </Block>
  );
}

export function OrgSports({
  sports,
  custom = [],
  compact,
}: {
  sports: Pick<SportView, 'id' | 'name' | 'icon'>[];
  custom?: string[];
  compact?: boolean;
}) {
  const all = [...sports, ...custom.map((name) => ({ id: `custom-${name}`, name, icon: null }))];
  return (
    <Block title="Направления" compact={compact}>
      {all.length ? (
        <ul className={styles.sports}>
          {all.map((s) => (
            <li key={s.id} className={styles.sport}>
              <SportIcon sport={s} size={20} />
              {s.name}
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.placeholder}>Направления не выбраны</p>
      )}
    </Block>
  );
}

export function OrgPlace({
  city,
  districtName,
  address,
  compact,
  children,
}: {
  city: string;
  districtName: string | null;
  address: string;
  compact?: boolean;
  /** Мини-карта мест встреч. */
  children?: ReactNode;
}) {
  const area = [city, districtName].filter(Boolean).join(', ');
  return (
    <Block title="Где занимаемся" compact={compact}>
      <div className={styles.place}>
        <MapPinIcon size={22} aria-hidden />
        <div>
          {address.trim() ? <p className={styles.address}>{address}</p> : null}
          <p className={address.trim() ? styles.area : styles.address}>{area || 'Красноярск'}</p>
        </div>
      </div>
      {children}
    </Block>
  );
}

export function OrgContacts({
  phone,
  email,
  social,
  compact,
}: {
  phone: string;
  email: string;
  social: string;
  compact?: boolean;
}) {
  const empty = !phone.trim() && !email.trim() && !social.trim();
  return (
    <Block title="Контакты" compact={compact}>
      {empty ? (
        <p className={styles.placeholder}>Телефон, почта или страница в соцсети</p>
      ) : (
        <ul className={styles.contacts}>
          {phone.trim() && (
            <li>
              <a className={styles.contact} href={`tel:${phone.replace(/[^\d+]/g, '')}`}>
                <PhoneIcon size={22} aria-hidden />
                <span className="tabular">{phone}</span>
              </a>
            </li>
          )}
          {email.trim() && (
            <li>
              <a className={styles.contact} href={`mailto:${email.trim()}`}>
                <AtIcon size={22} aria-hidden />
                <span>{email}</span>
              </a>
            </li>
          )}
          {social.trim() && (
            <li>
              <a
                className={styles.contact}
                href={socialHref(social)}
                target="_blank"
                rel="noreferrer noopener"
              >
                <GlobeIcon size={22} aria-hidden />
                <span>{socialLabel(social)}</span>
              </a>
            </li>
          )}
        </ul>
      )}
    </Block>
  );
}
