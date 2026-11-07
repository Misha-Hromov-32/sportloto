import { CheckCircleIcon, FileArrowUpIcon, InfoIcon } from '@phosphor-icons/react';
import { Input } from 'antd';
import { useId, useRef, useState } from 'react';

import { Button, Section } from '@/components';
import { COMMUNITY_API, useAction } from '@/lib/api';
import { count } from '@/lib/plural';
import type { ImportUploadResult } from '@/types/community';

import styles from './imports.module.css';

const POSTS = ['пост', 'поста', 'постов'] as const;
const EXAMPLE_URL = '/demo/community-posts.json';

function resultText(r: ImportUploadResult): string {
  const parts = [
    r.added ? `Добавлено в очередь: ${count(r.added, POSTS)}` : 'Новых постов нет',
    r.notMeeting ? `из них не похожи на встречу: ${r.notMeeting}` : '',
    r.duplicates ? `уже были загружены раньше: ${r.duplicates}` : '',
    r.skipped ? `пропущено пустых: ${r.skipped}` : '',
  ].filter(Boolean);
  return `${parts.join(', ')}.`;
}

export function UploadPanel({ onUploaded }: { onUploaded: () => void }) {
  const id = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportUploadResult | null>(null);
  const [busy, setBusy] = useState<'file' | 'example' | null>(null);
  const { run } = useAction<ImportUploadResult>();

  const upload = async (content: string, example = false) => {
    setError('');
    setResult(null);
    try {
      const res = await run(COMMUNITY_API.uploadImport, { content, sourceUrl: url.trim() || undefined, example }, { silent: true });
      setResult(res as unknown as ImportUploadResult);
      onUploaded();
    } catch (e) {
      const fields = (e as { errors?: Record<string, string>; message?: string });
      setError(fields.message ?? 'Не удалось загрузить файл. Попробуйте ещё раз');
    }
  };

  const fromFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy('file');
    try {
      if (file.size > 1_000_000) {
        setError('Файл больше 1 МБ. Разделите выгрузку на части');
        return;
      }
      await upload(await file.text());
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const example = async () => {
    setBusy('example');
    try {
      const res = await fetch(EXAMPLE_URL);
      if (!res.ok) throw new Error('example');
      await upload(await res.text(), true);
    } catch {
      setError('Не удалось открыть образец выгрузки. Проверьте интернет и попробуйте ещё раз');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section title="Загрузить посты сообщества">
      <div className={styles.upload}>
        <div className={styles.uploadFields}>
          <label className={styles.label} htmlFor={`${id}-url`}>
            Адрес сообщества (необязательно)
          </label>
          <Input
            id={`${id}-url`}
            value={url}
            placeholder="vk.com/club242415813"
            onChange={(e) => setUrl(e.target.value)}
            status={error && /адрес/i.test(error) ? 'error' : undefined}
          />
          <p className={styles.hint}>
            Подойдёт JSON стены ВКонтакте или текстовый файл, где посты разделены пустой строкой. Если в файле нет
            адреса сообщества, укажите его здесь.
          </p>
        </div>
        <div className={styles.uploadActions}>
          <input
            ref={fileRef}
            id={`${id}-file`}
            className={styles.fileInput}
            type="file"
            accept=".json,.txt,application/json,text/plain"
            onChange={(e) => void fromFile(e.target.files?.[0])}
            tabIndex={-1}
          />
          <Button
            variant="primary"
            icon={<FileArrowUpIcon size={20} aria-hidden />}
            loading={busy === 'file'}
            disabled={busy !== null}
            onClick={() => fileRef.current?.click()}
          >
            Выбрать файл
          </Button>
          <Button variant="secondary" loading={busy === 'example'} disabled={busy !== null} onClick={() => void example()}>
            Загрузить образец выгрузки
          </Button>
        </div>
        {result && (
          <p className={styles.result} role="status">
            <CheckCircleIcon size={20} weight="bold" aria-hidden />
            <span>{resultText(result)} Имена авторов не сохраняются, телефоны и почта в тексте скрыты.</span>
          </p>
        )}
        {error && (
          <p className={[styles.result, styles.problems].join(' ')} role="alert">
            <InfoIcon size={20} aria-hidden />
            <span>{error}</span>
          </p>
        )}
      </div>
    </Section>
  );
}
