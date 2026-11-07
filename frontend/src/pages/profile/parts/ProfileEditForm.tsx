import { FloppyDiskIcon } from '@phosphor-icons/react';
import { useList, useUpdate, type HttpError } from '@refinedev/core';
import { Form, Input, InputNumber, Radio, Segmented, Select } from 'antd';
import { useState } from 'react';

import { Button, SportIcon } from '@/components';
import { errorMessage } from '@/lib/api';
import { READINESS } from '@/lib/labels';
import type { Identity, SportView } from '@/types/api';
import { cityByName, districtsOf } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { choosable, WITH_HIDDEN } from '@/lib/sportChoices';
import type { District, Readiness, SkillLevel } from '@/types/domain';
import type { ProfilePatch } from '@/types/inputs';

import { fromChoice, toChoice, type GenderChoice } from '../gender/gender';
import { GenderField } from '../gender/GenderDialog';
import { LEVEL_ORDER, LEVEL_WORDS } from './levels';
import { ProfilePhoto } from './ProfilePhoto';
import { VkImport } from './VkImport';
import styles from './ProfileEditForm.module.css';

interface Values {
  name: string;
  age: number | null;
  districtId: string | null;
  about: string;
  interests: string[];
  readiness: Readiness | 'none';
  /** В7: пол, по умолчанию «Не указывать». */
  gender: GenderChoice;
}

interface ProfileEditFormProps {
  me: Identity;
  onDone: () => void;
}

export function ProfileEditForm({ me, onDone }: ProfileEditFormProps) {
  const [form] = Form.useForm<Values>();
  const [levels, setLevels] = useState<Record<string, SkillLevel>>(me.levels);
  const [error, setError] = useState<string | null>(null);
  const interests = Form.useWatch('interests', form) ?? me.interests.map((s) => s.id);
  const selectedCity = useSelectedCity();
  const districts = districtsOf(
    useList<District>({ resource: 'districts', pagination: { mode: 'off' } }).result.data,
    cityByName(me.city) ?? selectedCity,
    me.districtId,
  );
  const allSports = useList<SportView>({ resource: 'sports', filters: WITH_HIDDEN, pagination: { mode: 'off' } })
    .result.data;
  const sports = choosable(allSports, interests);
  const { mutateAsync, mutation } = useUpdate<Identity, HttpError, ProfilePatch>();
  const sportById = new Map([...sports, ...me.interests].map((s) => [s.id, s]));

  const submit = async (values: Values) => {
    setError(null);
    const patch: ProfilePatch = {
      name: values.name.trim(),
      age: values.age ?? null,
      districtId: values.districtId ?? null,
      about: values.about.trim(),
      interests: values.interests,
      levels: Object.fromEntries(values.interests.map((id) => [id, levels[id] ?? 'beginner'])),
      readiness: values.readiness === 'none' ? null : values.readiness,
      gender: fromChoice(values.gender),
    };
    try {
      await mutateAsync({
        resource: 'users',
        id: me.id,
        values: patch,
        successNotification: { type: 'success', message: 'Профиль сохранён' },
        errorNotification: false,
      });
      onDone();
    } catch (e) {
      const fields = (e as { errors?: Record<string, string> }).errors;
      if (fields)
        form.setFields(
          Object.entries(fields).map(([name, msg]) => ({ name: name as keyof Values, errors: [msg] })),
        );
      setError(errorMessage(e, 'Не получилось сохранить профиль. Попробуйте ещё раз'));
    }
  };

  return (
    <Form<Values>
      form={form}
      layout="vertical"
      requiredMark={false}
      className={styles.form}
      initialValues={{
        name: me.name,
        age: me.age,
        districtId: me.districtId,
        about: me.about,
        interests: me.interests.map((s) => s.id),
        readiness: me.readiness ?? 'none',
        gender: toChoice(me.gender),
      }}
      onFinish={submit}
      scrollToFirstError
    >
      <ProfilePhoto me={me} />
      <VkImport
        me={me}
        interests={() => (form.getFieldValue('interests') as string[] | undefined) ?? []}
        onApply={({ levels: next, ...patch }) => {
          form.setFieldsValue(patch);
          setLevels((prev) => ({ ...prev, ...next }));
        }}
      />

      <div className={styles.row}>
        <Form.Item
          label="Имя"
          name="name"
          className={styles.grow}
          rules={[{ required: true, whitespace: true, min: 2, message: 'Напишите, как к вам обращаться' }]}
        >
          <Input autoComplete="name" maxLength={60} />
        </Form.Item>
        <Form.Item label="Возраст" name="age" extra="Необязательно" className={styles.age}>
          <InputNumber min={14} max={110} inputMode="numeric" style={{ width: '100%' }} />
        </Form.Item>
      </div>

      <GenderField />

      <Form.Item
        label="Район"
        name="districtId"
        extra="По району подбираем занятия рядом с вами. Точный адрес не нужен."
      >
        <Select
          allowClear
          placeholder="Например, Центральный"
          options={districts.map((d) => ({ value: d.id, label: d.name }))}
        />
      </Form.Item>

      <Form.Item label="О себе" name="about" extra="Необязательно. Что любите, чего хотите попробовать.">
        <Input.TextArea rows={3} maxLength={500} showCount />
      </Form.Item>

      <Form.Item
        label="Чем занимаетесь"
        name="interests"
        extra="Выберите направления, затем уровень по каждому."
      >
        <Select
          mode="multiple"
          showSearch
          optionFilterProp="label"
          placeholder="Начните писать: бег, шахматы…"
          options={sports.map((s) => ({ value: s.id, label: s.name }))}
        />
      </Form.Item>

      {interests.length > 0 && (
        <ul className={styles.levels} aria-label="Уровень по направлениям">
          {interests.map((id) => {
            const sport = sportById.get(id);
            if (!sport) return null;
            return (
              <li key={id} className={styles.level}>
                <span className={styles.levelName}>
                  <SportIcon sport={sport} size={20} />
                  {sport.name}
                </span>
                <Segmented<SkillLevel>
                  value={levels[id] ?? 'beginner'}
                  onChange={(v) => setLevels((prev) => ({ ...prev, [id]: v }))}
                  options={LEVEL_ORDER.map((l) => ({ value: l, label: LEVEL_WORDS[l].label }))}
                  aria-label={`Уровень: ${sport.name}`}
                />
              </li>
            );
          })}
        </ul>
      )}

      <Form.Item label="Что вам ближе сейчас" name="readiness">
        <Radio.Group className={styles.radios}>
          {(Object.keys(READINESS) as Readiness[]).map((r) => (
            <Radio key={r} value={r}>
              <span className={styles.radioLabel}>{READINESS[r].label}</span>
              <span className={styles.radioHint}>{READINESS[r].hint}</span>
            </Radio>
          ))}
          <Radio value="none">
            <span className={styles.radioLabel}>Не показывать</span>
          </Radio>
        </Radio.Group>
      </Form.Item>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <div className={styles.actions}>
        <Button
          type="submit"
          variant="primary"
          icon={<FloppyDiskIcon size={20} aria-hidden />}
          loading={mutation.isPending}
          loadingText="Сохраняем…"
        >
          Сохранить профиль
        </Button>
        <Button variant="quiet" onClick={onDone} disabled={mutation.isPending}>
          Не сохранять
        </Button>
      </div>
    </Form>
  );
}
