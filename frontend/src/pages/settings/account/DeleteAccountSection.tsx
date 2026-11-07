import { TrashIcon } from '@phosphor-icons/react';
import { useLogout } from '@refinedev/core';
import { App, Form, Input, Modal } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { emailAuth } from '@/api';
import { Button } from '@/components';
import { useMe } from '@/lib/api';

import pageStyles from '../SettingsPage.module.css';
import styles from './account.module.css';

const CONSEQUENCES = [
  'Удалятся профиль, фото, интересы, уведомления и настройки.',
  'Записи на будущие события отменятся, организаторы получат уведомление.',
  'Ваши будущие события отменятся, записавшиеся получат уведомление.',
  'Объявления о поиске компании закроются.',
  'Сообщения в обсуждениях останутся, но без имени: вместо него будет «Удалённый пользователь».',
];

/** Удалить свой аккаунт (152-ФЗ): предупреждение, подтверждение паролем, выход на главную. */
export function DeleteAccountSection() {
  const { me } = useMe();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const { mutateAsync: logout } = useLogout();
  // Срабатывает, когда страница настроек закрылась: только после этого можно выходить из аккаунта.
  const onLeave = useRef<(() => void) | null>(null);
  useEffect(() => () => onLeave.current?.(), []);
  const [form] = Form.useForm<{ password: string }>();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;

  const ownOrg = me.orgs.find((o) => !o.managed);
  const blocked = me.demo
    ? 'Это демо-аккаунт: на нём показывают, как работает сайт, поэтому удалить его нельзя.'
    : me.userRole === 'admin'
      ? 'Аккаунт администратора удалить нельзя.'
      : ownOrg
        ? `Вы представитель организации «${ownOrg.name}». Напишите нам через раздел «Документы»: решим, кому передать организацию, и удалим аккаунт.`
        : null;

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const submit = async () => {
    const values = await form.validateFields().catch(() => null);
    if (!values) return;
    setBusy(true);
    setError(null);
    const res = await emailAuth.deleteAccount(values.password).catch(() => ({
      ok: false,
      message: 'Не удалось связаться с сервером. Проверьте интернет и попробуйте ещё раз',
      fieldErrors: undefined,
    }));
    setBusy(false);
    if (!res.ok) {
      const field = res.fieldErrors?.password;
      if (field) form.setFields([{ name: 'password', errors: [field] }]);
      else setError(res.message ?? 'Не получилось удалить аккаунт. Попробуйте ещё раз');
      return;
    }
    setOpen(false);
    // Сначала уходим на главную и ждём, пока личная страница закроется, иначе после выхода
    // проверка входа успеет отправить на «Вход» с возвратом в настройки.
    await new Promise<void>((resolve) => {
      onLeave.current = resolve;
      void navigate('/', { replace: true });
    });
    await logout({ redirectPath: false }).catch(() => undefined);
    message.success('Аккаунт удалён');
  };

  return (
    <>
      <p className={pageStyles.sectionIntro}>
        Аккаунт и данные о вас удалятся сразу, вернуть их не получится. С этой почтой потом можно
        зарегистрироваться заново.
      </p>
      {blocked ? (
        <p className={styles.blocked}>{blocked}</p>
      ) : (
        <Button variant="danger" icon={<TrashIcon size={18} aria-hidden />} onClick={() => setOpen(true)}>
          Удалить аккаунт
        </Button>
      )}
      <p className={pageStyles.note}>
        Что и сколько хранится, написано в{' '}
        <Link to="/legal/privacy">Политике обработки персональных данных</Link>.
      </p>

      <Modal
        open={open}
        title="Удалить аккаунт?"
        onCancel={close}
        maskClosable={!busy}
        width={560}
        destroyOnHidden
        afterOpenChange={(visible) => visible && form.focusField('password')}
        footer={
          <div className={styles.footer}>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Оставить аккаунт
            </Button>
            <Button variant="danger" onClick={() => void submit()} loading={busy} loadingText="Удаляем…">
              Удалить навсегда
            </Button>
          </div>
        }
      >
        <div className={styles.body}>
          <div className={styles.consequences}>
            <p className={styles.consequencesTitle}>Что произойдёт</p>
            <ul>
              {CONSEQUENCES.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <p>Отменить удаление нельзя.</p>
          </div>
          <Form form={form} layout="vertical" requiredMark={false} onFinish={() => void submit()}>
            <Form.Item
              name="password"
              label="Пароль"
              extra="Тот же, что при входе. Так мы убедимся, что аккаунт удаляете вы"
              rules={[{ required: true, message: 'Введите пароль' }]}
            >
              <Input.Password autoComplete="current-password" maxLength={128} />
            </Form.Item>
          </Form>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
