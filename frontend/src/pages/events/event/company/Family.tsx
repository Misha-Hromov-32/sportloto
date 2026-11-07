import { Input, InputNumber, Modal } from 'antd';
import { useState } from 'react';
import { Button } from '@/components';
import { API, useAction } from '@/lib/api';
import type { ChildSeat, EventFamily } from '@/types/domain';
import type { EventDetails } from '@/types/api';
import styles from './Company.module.css';
import { ageText, familyLabel } from './labels';

export function ChildrenFields({
  family,
  value,
  onChange,
}: {
  family: EventFamily;
  value: ChildSeat[];
  onChange: (value: ChildSeat[]) => void;
}) {
  return (
    <div className={styles.stack}>
      <p>
        {familyLabel(family)}.{' '}
        {family.kind === 'kids'
          ? 'Место занимает ребёнок, взрослый сопровождает.'
          : 'Вы занимаете одно место, каждый ребёнок — ещё одно.'}
      </p>
      {value.map((child, i) => (
        <div className={styles.row} key={i}>
          <label>
            Имя ребёнка
            <Input
              value={child.name}
              maxLength={40}
              onChange={(e) => onChange(value.map((c, n) => (n === i ? { ...c, name: e.target.value } : c)))}
            />
          </label>
          <label>
            Возраст
            <InputNumber
              min={family.minAge ?? 0}
              max={family.maxAge ?? 17}
              value={child.age}
              onChange={(age) => onChange(value.map((c, n) => (n === i ? { ...c, age: age ?? 0 } : c)))}
            />
          </label>
          <Button
            size="sm"
            variant="quiet"
            aria-label={`Убрать ребёнка ${i + 1}`}
            onClick={() => onChange(value.filter((_, n) => n !== i))}
          >
            Убрать
          </Button>
        </div>
      ))}
      {value.length < 4 && (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => onChange([...value, { name: '', age: family.minAge ?? 6 }])}
        >
          Добавить ребёнка
        </Button>
      )}
      <p className={styles.note}>
        Укажите только имя и возраст. Подтверждая запись, вы берёте ответственность за детей на встрече.
      </p>
    </div>
  );
}

export function FamilyParticipation({ event: e }: { event: EventDetails }) {
  const [open, setOpen] = useState(false);
  const [children, setChildren] = useState<ChildSeat[]>([]);
  const { run, isPending } = useAction();
  if (
    !e.family ||
    !e.my ||
    !['confirmed', 'pending', 'waitlist'].includes(e.my.status) ||
    e.state !== 'upcoming'
  )
    return null;
  const save = async () => {
    try {
      await run(API.children(e.id), { children }, { method: 'put', success: 'Запись детей обновлена' });
      setOpen(false);
    } catch {
      /* сообщение API */
    }
  };
  return (
    <section className={styles.panel} aria-label="Семейная запись">
      <h2>Идём с детьми</h2>
      <p>
        {e.my.children?.length
          ? e.my.children.map((c) => `${c.name}, ${ageText(c.age)}`).join('; ')
          : 'Дети пока не добавлены в вашу запись.'}
      </p>
      <Button
        variant="secondary"
        onClick={() => {
          setChildren(structuredClone(e.my?.children ?? []));
          setOpen(true);
        }}
      >
        Изменить запись детей
      </Button>
      <Modal
        title="Кто пойдёт с вами"
        open={open}
        onCancel={() => setOpen(false)}
        footer={
          <Button variant="primary" loading={isPending} onClick={() => void save()}>
            Сохранить
          </Button>
        }
      >
        <ChildrenFields family={e.family} value={children} onChange={setChildren} />
      </Modal>
    </section>
  );
}
