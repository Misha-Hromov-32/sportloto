import { BookmarkSimpleIcon } from '@phosphor-icons/react';
import { Input, Modal } from 'antd';
import { useState } from 'react';

import { Button } from '@/components';
import { errorMessage, useAction, useMe } from '@/lib/api';

export function SaveSearchButton({
  criteria,
  query,
  summary,
}: {
  criteria: Record<string, unknown>;
  query: string;
  summary: string;
}) {
  const { me } = useMe();
  const { run, isPending } = useAction();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  if (me?.role === 'admin') return null;
  const save = async () => {
    const searchName = name.trim();
    if (!searchName) {
      setError('Назовите поиск');
      return;
    }
    try {
      await run(
        '/saved-searches',
        { name: searchName, criteria, query, summary },
        { silent: true, success: 'Поиск сохранён в «Моих занятиях» → «Избранное»' },
      );
      setOpen(false);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <>
      {me ? (
        <Button
          variant="secondary"
          icon={<BookmarkSimpleIcon size={18} aria-hidden />}
          onClick={() => {
            setName(summary.slice(0, 60));
            setError('');
            setOpen(true);
          }}
        >
          Сохранить поиск
        </Button>
      ) : (
        <Button variant="secondary" to={`/login?to=${encodeURIComponent('/events?' + query)}`}>
          Сохранить поиск
        </Button>
      )}
      <Modal
        open={open}
        title="Сохранить поиск"
        onCancel={() => setOpen(false)}
        onOk={() => void save()}
        confirmLoading={isPending}
        okText="Сохранить поиск"
        cancelText="Отмена"
        destroyOnHidden
      >
        <p>Сохраним выбранный город и условия поиска. Новые подходящие встречи появятся в уведомлениях.</p>
        <label htmlFor="saved-search-name">Название поиска</label>
        <Input
          id="saved-search-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setError('');
          }}
          maxLength={60}
          onPressEnter={() => void save()}
          aria-invalid={Boolean(error)}
        />
        {error && <p role="alert">{error}</p>}
      </Modal>
    </>
  );
}
