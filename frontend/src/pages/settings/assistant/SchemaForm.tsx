import { AutoComplete, Checkbox, Input, InputNumber, Radio, Select } from 'antd';
import { useId } from 'react';

import type { JsonSchema } from '@/types/mcp';

import { Field } from '../../events/create/fields';
import type { ArgValues } from './helpers';
import styles from './assistant.module.css';

export interface EventOption {
  value: string;
  label: string;
}

const BOOL_OPTIONS = [
  { value: 'unset', label: 'Не указано' },
  { value: 'yes', label: 'Да' },
  { value: 'no', label: 'Нет' },
];

function FieldControl({
  name,
  schema,
  value,
  onChange,
  id,
  events,
}: {
  name: string;
  schema: JsonSchema;
  value: unknown;
  onChange: (v: unknown) => void;
  id: string;
  events: EventOption[];
}) {
  if (schema.type === 'boolean') {
    if (name === 'confirm')
      return (
        <Checkbox id={id} checked={value === true} onChange={(e) => onChange(e.target.checked ? true : undefined)} className={styles.confirmBox}>
          Выполнить по-настоящему (confirm: true)
        </Checkbox>
      );
    return (
      <Radio.Group
        id={id}
        optionType="button"
        size="large"
        value={value === true ? 'yes' : value === false ? 'no' : 'unset'}
        options={BOOL_OPTIONS}
        onChange={(e) => onChange(e.target.value === 'yes' ? true : e.target.value === 'no' ? false : undefined)}
      />
    );
  }
  if (schema.type === 'integer' || schema.type === 'number')
    return (
      <InputNumber
        id={id}
        size="large"
        className={styles.number}
        min={schema.minimum}
        max={schema.maximum}
        precision={schema.type === 'integer' ? 0 : undefined}
        placeholder={schema.default !== undefined ? `По умолчанию ${String(schema.default)}` : undefined}
        value={typeof value === 'number' ? value : null}
        onChange={(v) => onChange(v ?? undefined)}
      />
    );
  if (schema.enum)
    return (
      <Select
        id={id}
        size="large"
        allowClear
        placeholder="Не указано"
        value={value as string | undefined}
        onChange={(v) => onChange(v ?? undefined)}
        options={schema.enum.map((v, i) => ({ value: v, label: `${schema.enumNames?.[i] ?? v} (${v})` }))}
      />
    );
  if (schema.format === 'date')
    return <Input id={id} size="large" type="date" value={(value as string) ?? ''} onChange={(e) => onChange(e.target.value || undefined)} />;
  if (name === 'event_id')
    return (
      <AutoComplete
        id={id}
        size="large"
        value={(value as string) ?? ''}
        options={events}
        onChange={(v) => onChange(v)}
        placeholder="Номер события или начните вводить название"
        filterOption={(input, option) =>
          `${option?.value ?? ''} ${option?.label ?? ''}`.toLowerCase().includes(input.toLowerCase())
        }
      />
    );
  if ((schema.maxLength ?? 0) > 200)
    return (
      <Input.TextArea
        id={id}
        autoSize={{ minRows: 2, maxRows: 6 }}
        maxLength={schema.maxLength}
        value={(value as string) ?? ''}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  return (
    <Input
      id={id}
      size="large"
      maxLength={schema.maxLength}
      placeholder={schema.pattern ? '09:00' : undefined}
      value={(value as string) ?? ''}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** Форма аргументов, собранная по `inputSchema` инструмента. */
export function SchemaForm({
  schema,
  values,
  onChange,
  errors,
  events,
}: {
  schema: JsonSchema;
  values: ArgValues;
  onChange: (values: ArgValues) => void;
  errors: Record<string, string>;
  events: EventOption[];
}) {
  const base = useId();
  const entries = Object.entries(schema.properties ?? {});
  if (!entries.length) return <p className={styles.muted}>У этого вызова нет аргументов.</p>;
  return (
    <div className={styles.argForm}>
      {entries.map(([name, p]) => {
        const id = `${base}-${name}`;
        const required = schema.required?.includes(name);
        return (
          <Field
            key={name}
            htmlFor={id}
            label={
              <>
                {p.title ?? name}
                <code className={styles.argName}>{name}</code>
              </>
            }
            optional={!required}
            hint={p.description}
            error={errors[name]}
          >
            <FieldControl
              name={name}
              schema={p}
              id={id}
              value={values[name]}
              events={events}
              onChange={(v) => onChange({ ...values, [name]: v })}
            />
          </Field>
        );
      })}
    </div>
  );
}
