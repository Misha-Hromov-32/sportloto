import { ArrowSquareOutIcon } from '@phosphor-icons/react';
import { Form, Input, Modal, Select } from 'antd';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';

import { Button } from '@/components';
import type { PlatformRule } from '@/types/domain';

import styles from './admin.module.css';

export interface DecisionValues {
  ruleId?: string;
  reason: string;
}

interface DecisionModalProps {
  open: boolean;
  title: string;
  /** Что произойдёт после решения — простыми словами. */
  consequences: ReactNode[];
  confirmLabel: string;
  confirmTone?: 'primary' | 'danger';
  rules?: { list: PlatformRule[]; required: boolean; initial?: string | null };
  reason?: {
    label: string;
    hint?: string;
    required: boolean;
    templates?: string[];
    placeholder?: string;
  };
  onConfirm: (values: DecisionValues) => Promise<unknown>;
  onClose: () => void;
}

const MIN_REASON = 5;

/** Подтверждение решения администратора: последствия, пункт правил, причина с готовыми вариантами. */
export function DecisionModal({
  open,
  title,
  consequences,
  confirmLabel,
  confirmTone = 'primary',
  rules,
  reason,
  onConfirm,
  onClose,
}: DecisionModalProps) {
  const [form] = Form.useForm<DecisionValues>();
  const [busy, setBusy] = useState(false);
  const ruleId = Form.useWatch('ruleId', form);
  const rule = rules?.list.find((r) => r.id === ruleId);

  const submit = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setBusy(true);
    try {
      await onConfirm({ ruleId: values.ruleId, reason: (values.reason ?? '').trim() });
      onClose();
    } catch {
      /* текст ошибки уже показан, окно остаётся открытым с введёнными данными */
    } finally {
      setBusy(false);
    }
  };

  const addTemplate = (text: string) => {
    const current = (form.getFieldValue('reason') as string | undefined)?.trim() ?? '';
    form.setFieldValue('reason', current ? `${current} ${text}` : text);
    void form.validateFields(['reason']).catch(() => undefined);
  };

  return (
    <Modal
      open={open}
      title={title}
      onCancel={busy ? undefined : onClose}
      maskClosable={!busy}
      width={600}
      destroyOnHidden
      footer={
        <div className={styles.modalFooter}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Не сейчас
          </Button>
          <Button variant={confirmTone} onClick={() => void submit()} loading={busy} loadingText="Сохраняем…">
            {confirmLabel}
          </Button>
        </div>
      }
    >
      <div className={styles.modalBody}>
        <div className={styles.consequences}>
          <p className={styles.consequencesTitle}>Что произойдёт</p>
          <ul>
            {consequences.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </div>

        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ ruleId: rules?.initial ?? undefined, reason: '' }}
          onFinish={() => void submit()}
        >
          {rules && (
            <Form.Item
              name="ruleId"
              label="Какое правило нарушено"
              rules={rules.required ? [{ required: true, message: 'Выберите пункт правил' }] : []}
              extra={
                <span className={styles.ruleText}>
                  {rule ? rule.text : 'Пункт правил увидят организатор и участники.'}{' '}
                  <Link to="/rules" target="_blank" className={styles.inlineIcon}>
                    Все правила
                    <ArrowSquareOutIcon size={16} aria-hidden />
                  </Link>
                </span>
              }
            >
              <Select
                placeholder="Выберите пункт правил"
                options={rules.list.map((r) => ({ value: r.id, label: `${r.number}. ${r.title}` }))}
                allowClear={!rules.required}
              />
            </Form.Item>
          )}
          {reason && (
            <Form.Item
              name="reason"
              label={reason.required ? reason.label : `${reason.label} (необязательно)`}
              extra={
                (reason.hint || reason.templates?.length) && (
                  <span className={styles.stackList}>
                    {reason.hint && <span>{reason.hint}</span>}
                    {reason.templates && reason.templates.length > 0 && (
                      <span className={styles.templates} role="group" aria-label="Готовые варианты причины">
                        {reason.templates.map((t) => (
                          <button
                            key={t}
                            type="button"
                            className={styles.templateBtn}
                            onClick={() => addTemplate(t)}
                          >
                            {t}
                          </button>
                        ))}
                      </span>
                    )}
                  </span>
                )
              }
              rules={
                reason.required
                  ? [
                      {
                        validator: (_, v: string | undefined) =>
                          (v ?? '').trim().length >= MIN_REASON
                            ? Promise.resolve()
                            : Promise.reject(new Error('Напишите причину, хотя бы несколько слов')),
                      },
                    ]
                  : []
              }
            >
              <Input.TextArea
                autoSize={{ minRows: 3, maxRows: 8 }}
                maxLength={600}
                placeholder={reason.placeholder}
              />
            </Form.Item>
          )}
        </Form>
      </div>
    </Modal>
  );
}
