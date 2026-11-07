import { ArrowRight, MagnifyingGlass, Microphone, Stop } from '@phosphor-icons/react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';

import styles from './PhraseSearch.module.css';

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
  const w = window as unknown as { SpeechRecognition?: SpeechCtor; webkitSpeechRecognition?: SpeechCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

interface PhraseSearchProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  /** Пока помощник разбирает фразу. */
  loading?: boolean;
  placeholder?: string;
  label?: string;
  size?: 'md' | 'lg';
  autoFocus?: boolean;
}

/**
 * Поиск обычной фразой: «в субботу утром теннис, я новичок».
 * Голосовой ввод через браузер, если он его поддерживает; иначе кнопки микрофона нет.
 */
export function PhraseSearch({
  value,
  onChange,
  onSubmit,
  loading,
  placeholder = 'Например: в субботу утром теннис, я новичок',
  label = 'Опишите, что ищете',
  size = 'md',
  autoFocus,
}: PhraseSearchProps) {
  const id = useId();
  const [listening, setListening] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const [speechSupported] = useState(() => typeof window !== 'undefined' && getSpeech() !== null);

  useEffect(() => () => recognition.current?.stop(), []);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim()) onSubmit(value.trim());
  };

  const toggleVoice = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Ctor = getSpeech();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = 'ru-RU';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (event) => {
      const text = Array.from(event.results)
        .map((res) => res[0]?.transcript ?? '')
        .join(' ');
      onChange(text);
    };
    r.onerror = (event) => {
      setVoiceError(
        event.error === 'not-allowed'
          ? 'Разрешите доступ к микрофону в настройках браузера'
          : 'Не расслышали. Попробуйте ещё раз или напишите текстом',
      );
    };
    r.onend = () => setListening(false);
    recognition.current = r;
    setVoiceError('');
    setListening(true);
    r.start();
  };

  return (
    <form className={[styles.root, styles[size]].join(' ')} onSubmit={submit} role="search">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className={[styles.field, listening && styles.listening].filter(Boolean).join(' ')}>
        <MagnifyingGlass size={24} aria-hidden className={styles.lead} />
        <input
          id={id}
          className={styles.input}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={listening ? 'Говорите, я слушаю…' : placeholder}
          autoComplete="off"
          enterKeyHint="search"
          autoFocus={autoFocus}
        />
        {speechSupported && (
          <button
            type="button"
            className={styles.mic}
            onClick={toggleVoice}
            aria-pressed={listening}
            aria-label={listening ? 'Остановить голосовой ввод' : 'Сказать голосом'}
          >
            {listening ? <Stop size={22} weight="fill" aria-hidden /> : <Microphone size={22} aria-hidden />}
          </button>
        )}
        <button
          type="submit"
          className={styles.submit}
          disabled={loading || !value.trim()}
          aria-label="Найти"
        >
          {loading ? (
            <span className={styles.dots} aria-hidden />
          ) : (
            <ArrowRight size={24} weight="bold" aria-hidden />
          )}
        </button>
      </div>
      <p className={styles.status} role="status" aria-live="polite">
        {loading ? 'Помощник разбирает фразу…' : voiceError}
      </p>
    </form>
  );
}
