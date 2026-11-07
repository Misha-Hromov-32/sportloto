import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useMemo } from 'react';
import { Circle, MapContainer, Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router';

import { formatEventDate } from '@/lib/dates';
import { pointInCity } from '@/lib/cities';
import { useSelectedCity } from '@/lib/useSelectedCity';
import type { EventView } from '@/types/api';
import type { GeoPoint } from '@/types/domain';

import styles from './EventMap.module.css';
import { VectorBaseLayer } from './VectorBaseLayer';

interface EventMapProps {
  events: Pick<EventView, 'id' | 'title' | 'startsAt' | 'place' | 'sport'>[];
  /** Точка отсчёта пользователя и радиус «рядом со мной». */
  origin?: GeoPoint | null;
  radiusKm?: number | null;
  height?: number | string;
  zoom?: number;
}

function pin(label: string, active = false) {
  return L.divIcon({
    className: '',
    html: `<span class="${[styles.pin, active ? styles.pinActive : ''].join(' ')}"><span class="${styles.pinLabel}">${label}</span></span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -32],
  });
}

/** Карта на векторной подложке. Метки — буква направления, точка пользователя — отдельный знак. */
export function EventMap({ events, origin, radiusKm, height = 420, zoom = 12 }: EventMapProps) {
  const city = useSelectedCity();
  const center = events[0]?.place ?? (origin && pointInCity(origin, city) ? origin : city.center);
  const icons = useMemo(
    () => new Map(events.map((e) => [e.id, pin(e.sport.name[0]?.toUpperCase() ?? '•')])),
    [events],
  );
  const originIcon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: `<span class="${styles.origin}" aria-hidden></span>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
      }),
    [],
  );

  return (
    <div className={styles.root} style={{ height }}>
      <MapContainer
        key={city.id}
        center={[center.lat, center.lng]}
        zoom={zoom}
        scrollWheelZoom={false}
        className={styles.map}
      >
        <VectorBaseLayer />
        {origin && (
          <>
            <Marker position={[origin.lat, origin.lng]} icon={originIcon} title="Ваша точка отсчёта" />
            {radiusKm ? (
              <Circle
                center={[origin.lat, origin.lng]}
                radius={radiusKm * 1000}
                pathOptions={{ className: styles.radius }}
              />
            ) : null}
          </>
        )}
        {events.map((e) => (
          <Marker key={e.id} position={[e.place.lat, e.place.lng]} icon={icons.get(e.id)} title={e.title}>
            <Popup>
              <span className={styles.popup}>
                <Link to={`/events/${e.id}`} className={styles.popupTitle}>
                  {e.title}
                </Link>
                <span>{formatEventDate(e.startsAt)}</span>
                <span className={styles.popupPlace}>{e.place.address}</span>
              </span>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
