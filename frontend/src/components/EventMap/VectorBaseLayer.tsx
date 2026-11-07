import type { Layer, Map as LeafletMap } from 'leaflet';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { useEffect, useSyncExternalStore } from 'react';
import { useMap } from 'react-leaflet';

type MapTone = 'light' | 'dark';

const TILES_URL = '/map-tiles/{z}/{x}/{y}.mvt';
const ASSETS_URL = 'https://protomaps.github.io/basemaps-assets';
const ATTRIBUTION =
  '<a href="https://protomaps.com">Protomaps</a> &copy; участники <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';

function readTone(): MapTone {
  const theme = document.documentElement.dataset.theme;
  return theme === 'dark' || theme === 'midnight' ? 'dark' : 'light';
}

function subscribeTone(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

/** MapLibre весит много, поэтому грузится отдельным куском уже после того, как Leaflet нарисовал карту. */
async function loadVectorLayer() {
  const [{ layers, namedFlavor }, { setWorkerUrl }] = await Promise.all([
    import('@protomaps/basemaps'),
    import('maplibre-gl'),
    import('maplibre-gl/dist/maplibre-gl.css'),
  ]);
  setWorkerUrl(workerUrl);
  const { maplibreGL } = await import('@maplibre/maplibre-gl-leaflet');

  return (tone: MapTone, map: LeafletMap) => {
    const layer = maplibreGL({
      style: {
        version: 8,
        glyphs: `${ASSETS_URL}/fonts/{fontstack}/{range}.pbf`,
        sprite: `${ASSETS_URL}/sprites/v4/${tone}`,
        sources: {
          glpm: { type: 'vector', tiles: [TILES_URL], maxzoom: 14 },
        },
        // Карта города: линии государственных и региональных границ здесь не нужны.
        layers: layers('glpm', namedFlavor(tone), { lang: 'ru' }).filter(
          (l) => !l.id.startsWith('boundaries'),
        ),
      },
      maxZoom: 18,
      attributionControl: { customAttribution: ATTRIBUTION },
    }).addTo(map);
    // В наборе значков есть не все виды мест из тайлов: такие места показываем подписью без значка.
    const gl = layer.getMaplibreMap();
    gl.on('styleimagemissing', ({ id }: { id: string }) => {
      if (!gl.hasImage(id)) gl.addImage(id, { width: 1, height: 1, data: new Uint8Array(4) });
    });
    return layer;
  };
}

let vectorLayerFactory: ReturnType<typeof loadVectorLayer> | null = null;

/** Векторная подложка карты вместо растровых тайлов: подписи по-русски, тёмный вариант для тёмной темы. */
export function VectorBaseLayer() {
  const map = useMap();
  const tone = useSyncExternalStore(subscribeTone, readTone, () => 'light' as const);

  // По умолчанию Leaflet ставит перед своим названием флаг; оставляем только название со ссылкой.
  useEffect(() => {
    map.attributionControl?.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  }, [map]);

  useEffect(() => {
    let layer: Layer | null = null;
    let cancelled = false;
    vectorLayerFactory ??= loadVectorLayer();
    vectorLayerFactory
      .then((create) => {
        if (cancelled) return;
        layer = create(tone, map);
      })
      .catch(() => {
        vectorLayerFactory = null;
      });
    return () => {
      cancelled = true;
      layer?.remove();
    };
  }, [map, tone]);

  return null;
}
