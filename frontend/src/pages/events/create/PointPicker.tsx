import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import { MapContainer, Marker, useMap, useMapEvents } from 'react-leaflet';

import { Button } from '@/components';
import { VectorBaseLayer } from '@/components/EventMap/VectorBaseLayer';
import { KRASNOYARSK_CENTER } from '@/lib/geo';
import type { GeoPoint } from '@/types/domain';

import styles from './PointPicker.module.css';

/** Точку поставили не щелчком (по адресу): показать её, если она за краем карты. */
function KeepInView({ point }: { point: GeoPoint | null }) {
  const map = useMap();
  const lat = point?.lat;
  const lng = point?.lng;
  useEffect(() => {
    if (lat === undefined || lng === undefined) return;
    if (!map.getBounds().pad(-0.1).contains([lat, lng])) map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }, [map, lat, lng]);
  return null;
}

function ClickToSet({ onChange }: { onChange: (p: GeoPoint) => void }) {
  useMapEvents({
    click: (e) => onChange({ lat: Math.round(e.latlng.lat * 1e5) / 1e5, lng: Math.round(e.latlng.lng * 1e5) / 1e5 }),
  });
  return null;
}

/** Точка встречи на карте: нажмите на карту, чтобы поставить или передвинуть метку. */
export default function PointPicker({
  point,
  center,
  onChange,
}: {
  point: GeoPoint | null;
  center: GeoPoint | null;
  onChange: (p: GeoPoint | null) => void;
}) {
  const start = point ?? center ?? KRASNOYARSK_CENTER;
  const icon = useMemo(
    () =>
      L.divIcon({
        className: '',
        html: `<span class="${styles.pin}"></span>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      }),
    [],
  );
  return (
    <div className={styles.root}>
      <div className={styles.map}>
        <MapContainer center={[start.lat, start.lng]} zoom={point ? 15 : 13} scrollWheelZoom={false} className={styles.leaflet}>
          <VectorBaseLayer />
          <ClickToSet onChange={onChange} />
          <KeepInView point={point} />
          {point && (
            <Marker
              position={[point.lat, point.lng]}
              icon={icon}
              draggable
              title="Место встречи"
              eventHandlers={{
                dragend: (e) => {
                  const ll = (e.target as L.Marker).getLatLng();
                  onChange({ lat: ll.lat, lng: ll.lng });
                },
              }}
            />
          )}
        </MapContainer>
      </div>
      <div className={styles.bar}>
        <p className={styles.text} aria-live="polite">
          {point ? 'Точка стоит. Нажмите в другом месте карты, чтобы передвинуть.' : 'Нажмите на карту там, где встречаетесь.'}
        </p>
        {point && (
          <Button variant="quiet" size="sm" onClick={() => onChange(null)}>
            Убрать точку
          </Button>
        )}
      </div>
    </div>
  );
}
