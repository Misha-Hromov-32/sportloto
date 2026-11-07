import { CaretDownIcon, CheckIcon, MagnifyingGlassIcon, MapPinIcon } from '@phosphor-icons/react';
import { Input, Popover } from 'antd';
import { useRef, useState } from 'react';

import { CITIES, selectCity, type CityId } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';

import styles from './CityPicker.module.css';

export function CityPicker() {
  const city = useSelectedCity();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const visible = CITIES.filter((c) =>
    c.name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')),
  );
  const choose = (id: CityId) => {
    selectCity(id);
    setOpen(false);
    trigger.current?.focus();
  };

  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        setOpen(value);
        if (value) setSearch('');
      }}
      trigger="click"
      placement="bottom"
      content={
        <div
          className={styles.panel}
          role="dialog"
          aria-label="Выбор города"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <h2>Выберите город</h2>
          <p className={styles.hint}>Покажем события в выбранном городе.</p>
          <Input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            allowClear
            prefix={<MagnifyingGlassIcon size={18} aria-hidden />}
            placeholder="Найти город"
            aria-label="Найти город"
          />
          <div className={styles.options} role="group" aria-label="Доступные города">
            {visible.map((option) => (
              <button
                key={option.id}
                type="button"
                className={styles.option}
                aria-pressed={city.id === option.id}
                onClick={() => choose(option.id)}
              >
                <span>
                  <strong>{option.name}</strong>
                  <small>{option.region}</small>
                </span>
                {city.id === option.id && <CheckIcon size={20} weight="bold" aria-hidden />}
              </button>
            ))}
            {!visible.length && (
              <p className={styles.empty}>Город не найден. Доступны: {CITIES.map((c) => c.name).join(', ')}.</p>
            )}
          </div>
        </div>
      }
    >
      <button
        ref={trigger}
        type="button"
        className={styles.trigger}
        aria-label={`Выбрать город: ${city.name}`}
        aria-expanded={open}
        aria-haspopup="dialog"
      >
        <MapPinIcon size={16} className={styles.pin} aria-hidden />
        <span>{city.name}</span>
        <CaretDownIcon size={12} aria-hidden />
      </button>
    </Popover>
  );
}
