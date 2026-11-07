import 'leaflet/dist/leaflet.css';

import L from 'leaflet';
import { useMemo } from 'react';
import { MapContainer, Marker, Popup } from 'react-leaflet';
import { Link } from 'react-router';

import { VectorBaseLayer } from '@/components/EventMap/VectorBaseLayer';
import { useSelectedCity } from '@/lib/useSelectedCity';
import { venuePriceLine } from '@/lib/venues';
import type { VenueView } from '@/types/api';
import type { GeoPoint } from '@/types/domain';

import styles from './venues.module.css';

type MapVenue = Pick<VenueView, 'id' | 'name' | 'address' | 'lat' | 'lng' | 'kindLabel' | 'pricePerHour' | 'peakPricePerHour'>;

interface VenueMapProps {
  venues: MapVenue[];
  height?: number;
  zoom?: number;
  center?: GeoPoint | null;
  /** На странице площадки ссылка во всплывающей подсказке не нужна. */
  links?: boolean;
}

function pin(label: string) {
  return L.divIcon({
    className: '',
    html: `<span class="${styles.pin}"><span class="${styles.pinLabel}">${label}</span></span>`,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -32],
  });
}

/** Карта площадок: метка — первая буква типа площадки. */
export default function VenueMap({ venues, height = 480, zoom = 12, center, links = true }: VenueMapProps) {
  const city = useSelectedCity();
  const focus = center ?? venues[0] ?? city.center;
  const icons = useMemo(
    () => new Map(venues.map((v) => [v.id, pin(v.kindLabel[0]?.toUpperCase() ?? '•')])),
    [venues],
  );
  return (
    <div className={styles.map} style={{ height }}>
      <MapContainer
        key={`${city.id}-${venues.map((v) => v.id).join(',')}`}
        {...(venues.length > 1 && !center
          ? {
              bounds: L.latLngBounds(venues.map((v) => [v.lat, v.lng] as [number, number])),
              boundsOptions: { padding: [32, 32] as [number, number] },
            }
          : { center: [focus.lat, focus.lng] as [number, number], zoom })}
        scrollWheelZoom={false}
        className={styles.mapInner}
      >
        <VectorBaseLayer />
        {venues.map((v) => (
          <Marker key={v.id} position={[v.lat, v.lng]} icon={icons.get(v.id)} title={v.name}>
            <Popup>
              <span className={styles.popup}>
                {links ? (
                  <Link to={`/venues/${v.id}`} className={styles.popupTitle}>
                    {v.name}
                  </Link>
                ) : (
                  <b className={styles.popupTitle}>{v.name}</b>
                )}
                <span>{v.address}</span>
                <span className={styles.popupMuted}>{venuePriceLine(v)}</span>
              </span>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
