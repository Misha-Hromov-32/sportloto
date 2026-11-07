import { Input, Select } from 'antd';

import { Avatar } from '@/components';
import { count } from '@/lib/plural';
import { cityByName, districtsOf } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { District } from '@/types/domain';
import type { Identity, SportView } from '@/types/api';

import { CoverPicker } from './CoverPicker';
import { Field } from './Field';
import styles from './FormParts.module.css';
import { LogoPicker } from './LogoPicker';
import {
  describedBy,
  DESCRIPTION_MIN,
  fieldId,
  type OrgErrors,
  type ErrorField,
  type OrgFormValues,
} from './formModel';
import { SportsPicker } from './SportsPicker';
import { TypePicker } from './TypePicker';

const LEFT = ['знак', 'знака', 'знаков'] as const;

interface OrgFormProps {
  values: OrgFormValues;
  onChange: (patch: Partial<OrgFormValues>, field?: ErrorField) => void;
  errors: OrgErrors;
  catalog: SportView[];
  districts: District[];
  me: Identity;
}

/** Ручная форма заявки. Все поля короткие: тип организации — просто подпись на странице. */
export function OrgForm({ values, onChange, errors, catalog, districts, me }: OrgFormProps) {
  const id = fieldId;
  const selectedCity = useSelectedCity();
  const descLength = values.description.trim().length;
  const descLeft = DESCRIPTION_MIN - descLength;

  return (
    <div className={styles.form}>
      <fieldset className={styles.group}>
        <legend className={styles.legend}>Об организации</legend>
        <Field
          id={id('name')}
          label="Название"
          hint="Так, как вас знают участники. Например, беговой клуб «Енисей» или «Зарядка во дворе на Мира, 10»"
          error={errors.name}
          assisted={values.assisted.name}
        >
          <Input
            id={id('name')}
            value={values.name}
            onChange={(e) => onChange({ name: e.target.value }, 'name')}
            maxLength={80}
            status={errors.name ? 'error' : undefined}
            aria-invalid={Boolean(errors.name) || undefined}
            aria-describedby={describedBy(id('name'), true, errors.name)}
          />
        </Field>

        <Field id={id('type')} label="Кто вы" group error={errors.type} assisted={values.assisted.type}>
          <TypePicker
            value={values.type}
            onChange={(type) => onChange({ type }, 'type')}
            invalid={Boolean(errors.type)}
            describedBy={describedBy(id('type'), false, errors.type)}
          />
        </Field>

        <Field
          id={id('description')}
          label="О деятельности"
          hint="Что вы проводите, для кого, как часто. Например: «Бегаем по субботам в 9:00 на Татышеве, есть группа для новичков»"
          error={errors.description}
          assisted={values.assisted.description}
          aside={
            <span className={descLeft > 0 ? styles.counterWarn : styles.counter}>
              {descLeft > 0 ? `Ещё ${count(descLeft, LEFT)}` : `${descLength} из 1500`}
            </span>
          }
        >
          <Input.TextArea
            id={id('description')}
            value={values.description}
            onChange={(e) => onChange({ description: e.target.value }, 'description')}
            autoSize={{ minRows: 4, maxRows: 12 }}
            maxLength={1500}
            status={errors.description ? 'error' : undefined}
            aria-invalid={Boolean(errors.description) || undefined}
            aria-describedby={describedBy(id('description'), true, errors.description)}
          />
        </Field>

        <Field
          id="org-logo"
          label="Логотип"
          group
          optional
          hint="Буквы названия, готовый знак или своя картинка. Логотип будет на странице организации и рядом с её встречами."
          error={errors.logoUrl}
        >
          <LogoPicker
            name={values.name}
            value={values.logo}
            onChange={(logo) => onChange({ logo }, 'logoUrl')}
            describedBy={describedBy('org-logo', true, errors.logoUrl)}
          />
        </Field>

        <Field
          id="org-cover"
          label="Обложка страницы"
          group
          optional
          hint="Широкое фото для шапки страницы: ваш зал, площадка или общее фото с занятия. Подойдёт JPEG, PNG или WebP до 8 МБ."
          error={errors.coverUrl}
        >
          <CoverPicker
            name={values.name.trim()}
            value={values.coverUrl}
            onChange={(coverUrl) => onChange({ coverUrl }, 'coverUrl')}
            describedBy={describedBy('org-cover', true, errors.coverUrl)}
          />
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Направления</legend>
        <Field
          id={id('sportIds')}
          label="Чем занимаетесь"
          group
          hint="Можно несколько. Если нужного нет в каталоге, добавьте своё."
          error={errors.sportIds}
          assisted={values.assisted.sportIds}
        >
          <SportsPicker
            catalog={catalog}
            sportIds={values.sportIds}
            customSports={values.customSports}
            onChange={(next) => onChange(next, 'sportIds')}
            invalid={Boolean(errors.sportIds)}
            describedBy={describedBy(id('sportIds'), true, errors.sportIds)}
          />
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Где занимаетесь</legend>
        <div className={styles.row2}>
          <Field id="org-city" label="Город">
            <Input id="org-city" value={values.city} onChange={(e) => onChange({ city: e.target.value })} />
          </Field>
          <Field id={id('districtId')} label="Район" optional assisted={values.assisted.districtId}>
            <Select
              id={id('districtId')}
              value={values.districtId}
              onChange={(districtId: string | null) =>
                onChange({ districtId: districtId ?? null }, 'districtId')
              }
              allowClear
              placeholder="Выберите район"
              options={districtsOf(districts, cityByName(values.city) ?? selectedCity, values.districtId).map(
                (d) => ({ value: d.id, label: d.name }),
              )}
              className={styles.select}
            />
          </Field>
        </div>
        <Field
          id={id('address')}
          label="Где проходят занятия"
          optional
          hint="Адрес зала, парк или двор. Можно с ориентиром: «вход со двора, второй этаж»"
        >
          <Input
            id={id('address')}
            value={values.address}
            onChange={(e) => onChange({ address: e.target.value }, 'address')}
            maxLength={160}
            aria-describedby={`${id('address')}-hint`}
          />
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Контакты</legend>
        <p id={`${id('contacts')}-hint`} className={styles.hint}>
          Нужен телефон или почта. Контакты увидят администратор при проверке и участники на странице
          организации.
        </p>
        <div className={styles.row2}>
          <Field id="org-phone" label="Телефон" assisted={values.assisted.contacts}>
            <Input
              id="org-phone"
              value={values.phone}
              onChange={(e) => onChange({ phone: e.target.value }, 'contacts')}
              inputMode="tel"
              autoComplete="tel"
              placeholder="+7 900 123-45-67"
              status={errors.contacts ? 'error' : undefined}
              aria-invalid={Boolean(errors.contacts) || undefined}
              aria-describedby={describedBy(id('contacts'), true, errors.contacts)}
            />
          </Field>
          <Field id="org-email" label="Почта">
            <Input
              id="org-email"
              value={values.email}
              onChange={(e) => onChange({ email: e.target.value }, 'contacts')}
              inputMode="email"
              autoComplete="email"
              placeholder="club@mail.ru"
              status={errors.contacts ? 'error' : undefined}
              aria-invalid={Boolean(errors.contacts) || undefined}
              aria-describedby={describedBy(id('contacts'), true, errors.contacts)}
            />
          </Field>
        </div>
        {errors.contacts && (
          <p id={`${id('contacts')}-error`} className={styles.error}>
            {errors.contacts}
          </p>
        )}
        <Field id="org-social" label="Страница в соцсетях" optional>
          <Input
            id="org-social"
            value={values.social}
            onChange={(e) => onChange({ social: e.target.value }, 'contacts')}
            placeholder="vk.com/vash_klub"
            maxLength={120}
          />
        </Field>
      </fieldset>

      <fieldset className={styles.group}>
        <legend className={styles.legend}>Представитель</legend>
        <div className={styles.owner}>
          <Avatar name={me.name} initials={me.initials} src={me.avatarUrl} size={48} />
          <div>
            <p className={styles.ownerName}>{me.name}</p>
            <p className={styles.hint}>
              Это вы. Заявку подаёте от своего имени, решение администратора придёт вам в уведомления.
            </p>
          </div>
        </div>
      </fieldset>
    </div>
  );
}
