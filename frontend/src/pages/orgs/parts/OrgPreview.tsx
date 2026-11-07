import { EyeIcon } from '@phosphor-icons/react';
import { useMemo } from 'react';

import { ORG_TYPE } from '@/lib/labels';
import type { SportView } from '@/types/api';
import type { District } from '@/types/domain';

import { logoUrlOf } from './logos';
import { OrgHero } from './OrgHero';
import { OrgContacts, OrgDescription, OrgPlace, OrgSports } from './OrgInfo';
import type { OrgFormValues } from './formModel';
import styles from './OrgPreview.module.css';

/** Предпросмотр: так страницу увидят все после допуска. Собран из тех же блоков, что и сама страница. */
export function OrgPreview({
  values,
  catalog,
  districts,
}: {
  values: OrgFormValues;
  catalog: SportView[];
  districts: District[];
}) {
  const logoUrl = useMemo(() => logoUrlOf(values.logo), [values.logo]);
  const district = districts.find((d) => d.id === values.districtId)?.name ?? null;
  const sports = values.sportIds
    .map((id) => catalog.find((s) => s.id === id))
    .filter((s): s is SportView => Boolean(s));

  return (
    <section className={styles.preview} aria-labelledby="org-preview-title">
      <h2 id="org-preview-title" className={styles.caption}>
        <EyeIcon size={20} aria-hidden />
        Так будет выглядеть страница после допуска
      </h2>
      <div className={styles.frame}>
        <OrgHero
          as="p"
          name={values.name.trim()}
          typeLabel={values.type ? ORG_TYPE[values.type] : 'Тип организации'}
          logoUrl={logoUrl}
          coverUrl={values.coverUrl}
          city={values.city}
          districtName={district}
          verified="preview"
        />
        <div className={styles.body}>
          <OrgDescription title="О нас" text={values.description} compact />
          <OrgSports sports={sports} custom={values.customSports} compact />
          <OrgPlace city={values.city} districtName={district} address={values.address} compact />
          <OrgContacts phone={values.phone} email={values.email} social={values.social} compact />
          <section className={styles.events}>
            <h3 className={styles.eventsTitle}>Ближайшие встречи</h3>
            <p className={styles.eventsText}>
              После допуска здесь появятся встречи, которые вы опубликуете от имени организации.
            </p>
          </section>
        </div>
      </div>
    </section>
  );
}
