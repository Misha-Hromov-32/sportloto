import type { GeoPoint } from '@/types/domain';

const EARTH_KM = 6371;

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (x: number) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.sqrt(h));
}

/** «800 м», «2,4 км». */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.max(100, Math.round((km * 1000) / 100) * 100)}\u00A0м`;
  return `${km.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}\u00A0км`;
}

export const KRASNOYARSK_CENTER: GeoPoint = { lat: 56.0106, lng: 92.8526 };
export const RADIUS_OPTIONS = [1, 3, 5, 10] as const;
