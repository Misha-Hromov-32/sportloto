import { MicrophoneIcon, SparkleIcon, StopIcon } from '@phosphor-icons/react';
import { Input } from 'antd';
import { useEffect, useId, useRef, useState } from 'react';

import { AssistantThinking, Button } from '@/components';

import styles from './AssistantComposer.module.css';

interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
}

type SpeechCtor = new () => SpeechRecognitionLike;

function getSpeech(): SpeechCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Голосовой ввод через браузер. Если браузер не умеет, кнопки микрофона нет. */
function useSpeech(onText: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const [supported] = useState(() => getSpeech() !== null);
  const rec = useRef<SpeechRecognitionLike | null>(null);
  const latest = useRef(onText);
  latest.current = onText;

  useEffect(() => () => rec.current?.stop(), []);

  const toggle = () => {
    if (listening) {
      rec.current?.stop();
      return;
    }
    const Ctor = getSpeech();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = 'ru-RU';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (event) =>
      latest.current(
        Array.from(event.results)
          .map((res) => res[0]?.transcript ?? '')
          .join(' '),
      );
    r.onerror = (event) =>
      setError(
        event.error === 'not-allowed'
          ? 'Разрешите доступ к микрофону в настройках браузера'
          : 'Не расслышали. Скажите ещё раз или напишите текстом',
      );
    r.onend = () => setListening(false);
    rec.current = r;
    setError('');
    setListening(true);
    r.start();
  };

  return { supported, listening, error, toggle };
}

interface AssistantComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  label: string;
  placeholder: string;
  examples: string[];
  error?: string;
}

/** Большое поле «расскажите своими словами» с микрофоном и примерами. */
export function AssistantComposer({
  value,
  onChange,
  onSubmit,
  loading,
  label,
  placeholder,
  examples,
  error,
}: AssistantComposerProps) {
  const id = useId();
  const speech = useSpeech(onChange);
  const tooShort = value.trim().length < 5;

  return (
    <div className={styles.root}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      <div className={[styles.field, speech.listening && styles.listening].filter(Boolean).join(' ')}>
        <Input.TextArea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={speech.listening ? 'Говорите, я слушаю…' : placeholder}
          autoSize={{ minRows: 3, maxRows: 8 }}
          maxLength={600}
          variant="borderless"
          className={styles.textarea}
          disabled={loading}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !tooShort) onSubmit();
          }}
        />
        {speech.supported && (
          <button
            type="button"
            className={styles.mic}
            onClick={speech.toggle}
            aria-pressed={speech.listening}
            disabled={loading}
          >
            {speech.listening ? <StopIcon size={22} weight="fill" aria-hidden /> : <MicrophoneIcon size={22} aria-hidden />}
            <span>{speech.listening ? 'Остановить' : 'Сказать голосом'}</span>
          </button>
        )}
      </div>
      {(speech.error || error) && (
        <p className={styles.error} role="alert">
          {error || speech.error}
        </p>
      )}

      <div className={styles.examples}>
        <span className={styles.examplesTitle}>Например:</span>
        <div className={styles.exampleList}>
          {examples.map((ex) => (
            <button key={ex} type="button" className={styles.example} onClick={() => onChange(ex)} disabled={loading}>
              {ex}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.actions}>
        {loading ? (
          <AssistantThinking />
        ) : (
          <Button
            variant="primary"
            size="lg"
            icon={<SparkleIcon size={22} weight="fill" aria-hidden />}
            onClick={onSubmit}
            disabled={tooShort}
          >
            Собрать черновик
          </Button>
        )}
        {!loading && tooShort && (
          <span className={styles.hint}>Напишите хотя бы одну фразу: что, когда и где</span>
        )}
      </div>
    </div>
  );
}
