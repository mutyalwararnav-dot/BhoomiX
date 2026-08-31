'use client';

import {
  useEffect, useRef, useState, useCallback,
  forwardRef, useImperativeHandle,
} from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { supabase } from '@/lib/supabase';
import type { ParcelFeature } from '@/lib/supabase';
import { normalizeLinearRing, type LngLatCoordinate } from '@/lib/geometry';

const STATUS_COLOR: Record<string, string> = {
  ai_suggestion:   '#F59E0B',
  conflict:        '#F43F5E',
  confirmed:       '#10B981',
  pending:         '#94A3B8',
  reviewed_edited: '#6366F1',
  rejected:        '#64748B',
};

const SOURCE_ID    = 'bhoomix-parcels';
const FILL_LAYER   = 'parcels-fill';
const STROKE_LAYER = 'parcels-stroke';

const EDIT_POLY_SOURCE = 'bhoomix-edit-poly-source';
const EDIT_LINE_SOURCE = 'bhoomix-edit-line-source';
const EDIT_FILL        = 'bhoomix-edit-fill';
const EDIT_STROKE      = 'bhoomix-edit-stroke';
const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const IMAGERY_SOURCE_PREFIX = 'bhoomix-imagery-source-';
const IMAGERY_LAYER_PREFIX = 'bhoomix-imagery-layer-';
const ELEVATION_SOURCE_ID = 'bhoomix-ndsm-source';
const ELEVATION_LAYER_ID = 'bhoomix-ndsm-layer';

interface ImageryFootprint {
  id: string;
  filename: string;
  sourceCrs: string | null;
  boundingBox: [number, number, number, number];
  overlayUrl: string;
}

function createFallbackStyle(): maplibregl.StyleSpecification {
  return {
    version: 8,
    sources: {
      'osm-fallback': {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [
      {
        id: 'fallback-background',
        type: 'background',
        paint: { 'background-color': '#E8E5DF' },
      },
      {
        id: 'osm-fallback-layer',
        type: 'raster',
        source: 'osm-fallback',
        minzoom: 0,
        maxzoom: 19,
      },
    ],
  };
}

export interface WebGISMapHandle {
  getEditedGeometry: () => GeoJSON.Polygon | null;
}

interface WebGISMapProps {
  selectedParcel?: ParcelFeature | null;
  parcelVersion?: number;
  onParcelSelect?: (parcel: ParcelFeature) => void;
  elevationLayer?: {
    previewUrl: string;
    boundingBox: [number, number, number, number];
  } | null;
}

interface RenderedParcelPath {
  key: string;
  path: string;
  color: string;
}

function ringToScreenPath(
  map: maplibregl.Map,
  ring: readonly LngLatCoordinate[]
): string {
  return ring.map(([lng, lat], index) => {
    const point = map.project([lng, lat]);
    return `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
  }).join(' ') + ' Z';
}

function pointInRing(
  point: LngLatCoordinate,
  ring: readonly LngLatCoordinate[]
): boolean {
  const [lng, lat] = point;
  let inside = false;

  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current++) {
    const [currentLng, currentLat] = ring[current];
    const [previousLng, previousLat] = ring[previous];
    const crossesLatitude = (currentLat > lat) !== (previousLat > lat);
    const intersectionLng = (
      (previousLng - currentLng) * (lat - currentLat) /
      (previousLat - currentLat || Number.EPSILON)
    ) + currentLng;

    if (crossesLatitude && lng < intersectionLng) inside = !inside;
  }

  return inside;
}

function ensureBackgroundLayers(map: maplibregl.Map, initialData: GeoJSON.FeatureCollection) {
  if (!map || !map.getStyle()) return;

  try {
    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, { type: 'geojson', data: initialData });
    }
    if (!map.getLayer(FILL_LAYER)) {
      map.addLayer({
        id: FILL_LAYER, type: 'fill', source: SOURCE_ID,
        filter: ['!=', ['get', 'status'], 'rejected'],
        paint: {
          'fill-color': ['match', ['get', 'status'],
            'ai_suggestion', STATUS_COLOR.ai_suggestion,
            'conflict', STATUS_COLOR.conflict,
            'confirmed', STATUS_COLOR.confirmed,
            'reviewed_edited', STATUS_COLOR.reviewed_edited,
            '#6366F1'
          ],
          'fill-opacity': 0.35,
        },
      });
    }
    if (!map.getLayer(STROKE_LAYER)) {
      map.addLayer({
        id: STROKE_LAYER, type: 'line', source: SOURCE_ID,
        filter: ['!=', ['get', 'status'], 'rejected'],
        paint: {
          'line-color': ['match', ['get', 'status'],
            'ai_suggestion', STATUS_COLOR.ai_suggestion,
            'conflict', STATUS_COLOR.conflict,
            'confirmed', STATUS_COLOR.confirmed,
            'reviewed_edited', STATUS_COLOR.reviewed_edited,
            '#6366F1'
          ],
          'line-width': 1.5,
        },
      });
    }
  } catch {
    console.warn('[WebGISMap] MapLibre style not ready yet for background layers.');
  }
}

function ensureImageryLayers(map: maplibregl.Map, imagery: ImageryFootprint[]) {
  if (!map || !map.getStyle()) return;

  imagery.forEach((item) => {
    const [west, south, east, north] = item.boundingBox;
    if (![west, south, east, north].every(Number.isFinite)) return;

    const sourceId = `${IMAGERY_SOURCE_PREFIX}${item.id}`;
    const layerId = `${IMAGERY_LAYER_PREFIX}${item.id}`;

    try {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'image',
          url: item.overlayUrl,
          coordinates: [
            [west, north],
            [east, north],
            [east, south],
            [west, south],
          ],
        });
      }
      if (!map.getLayer(layerId)) {
        map.addLayer({
          id: layerId,
          type: 'raster',
          source: sourceId,
          paint: {
            'raster-opacity': 0.72,
            'raster-fade-duration': 0,
          },
        }, map.getLayer(FILL_LAYER) ? FILL_LAYER : undefined);
      }
    } catch (error) {
      console.warn(`[WebGISMap] Could not render imagery overlay ${item.filename}:`, error);
    }
  });
}

function setElevationLayer(
  map: maplibregl.Map,
  layer: WebGISMapProps['elevationLayer'],
) {
  if (map.getLayer(ELEVATION_LAYER_ID)) map.removeLayer(ELEVATION_LAYER_ID);
  if (map.getSource(ELEVATION_SOURCE_ID)) map.removeSource(ELEVATION_SOURCE_ID);
  if (!layer) return;
  const [west, south, east, north] = layer.boundingBox;
  map.addSource(ELEVATION_SOURCE_ID, {
    type: 'image',
    url: layer.previewUrl,
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
  });
  map.addLayer({
    id: ELEVATION_LAYER_ID,
    type: 'raster',
    source: ELEVATION_SOURCE_ID,
    paint: { 'raster-opacity': 0.72, 'raster-fade-duration': 0 },
  }, map.getLayer(FILL_LAYER) ? FILL_LAYER : undefined);
}

function ensureEditLayers(map: maplibregl.Map) {
  if (!map || !map.getStyle()) return;

  try {
    if (!map.getSource(EDIT_POLY_SOURCE)) {
      map.addSource(EDIT_POLY_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(EDIT_FILL)) {
      map.addLayer({
        id: EDIT_FILL, type: 'fill', source: EDIT_POLY_SOURCE,
        paint: { 'fill-color': '#6366F1', 'fill-opacity': 0.5 },
      });
    }

    if (!map.getSource(EDIT_LINE_SOURCE)) {
      map.addSource(EDIT_LINE_SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(EDIT_STROKE)) {
      map.addLayer({
        id: EDIT_STROKE, type: 'line', source: EDIT_LINE_SOURCE,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': 3 },
      });
    }
  } catch {
    console.warn('[WebGISMap] MapLibre style not ready yet for edit layers.');
  }
}

const WebGISMap = forwardRef<WebGISMapHandle, WebGISMapProps>(
  ({ selectedParcel, parcelVersion = 0, onParcelSelect, elevationLayer = null }, ref) => {
    const mapContainer = useRef<HTMLDivElement>(null);
    const mapRef       = useRef<maplibregl.Map | null>(null);

    const currentCoordsRef = useRef<LngLatCoordinate[] | null>(null);
    const markersRef       = useRef<maplibregl.Marker[]>([]);
    const parcelDataRef    = useRef<GeoJSON.FeatureCollection>({
      type: 'FeatureCollection',
      features: [],
    });
    const imageryRef = useRef<ImageryFootprint[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [mapReady, setMapReady]   = useState(false);
    const [parcelPaths, setParcelPaths] = useState<RenderedParcelPath[]>([]);
    const [editPath, setEditPath] = useState<string | null>(null);
    const [basemapWarning, setBasemapWarning] = useState<string | null>(null);
    const [imageryCount, setImageryCount] = useState(0);

    useImperativeHandle(ref, () => ({
      getEditedGeometry: () => {
        if (!currentCoordsRef.current) return null;
        return {
          type: 'Polygon',
          coordinates: [currentCoordsRef.current],
        };
      },
    }));

    const fetchParcels = useCallback(async (): Promise<GeoJSON.FeatureCollection> => {
      const { data, error } = await supabase.rpc('get_parcels_as_geojson');
      if (error) return { type: 'FeatureCollection', features: [] };

      let parsedData = data;
      if (typeof data === 'string') {
        try { parsedData = JSON.parse(data); } catch {}
      }
      return (parsedData as GeoJSON.FeatureCollection) ?? { type: 'FeatureCollection', features: [] };
    }, []);

    const fetchImagery = useCallback(async (): Promise<ImageryFootprint[]> => {
      try {
        const response = await fetch('/api/imagery/footprints', { cache: 'no-store' });
        if (!response.ok) return [];
        const payload = await response.json() as { footprints?: unknown };
        if (!Array.isArray(payload.footprints)) return [];

        return payload.footprints.filter((item): item is ImageryFootprint => {
          if (!item || typeof item !== 'object') return false;
          const candidate = item as Partial<ImageryFootprint>;
          return typeof candidate.id === 'string'
            && typeof candidate.filename === 'string'
            && typeof candidate.overlayUrl === 'string'
            && Array.isArray(candidate.boundingBox)
            && candidate.boundingBox.length === 4
            && candidate.boundingBox.every(value => typeof value === 'number' && Number.isFinite(value));
        });
      } catch {
        return [];
      }
    }, []);

    const refreshSvgOverlay = useCallback((map: maplibregl.Map) => {
      const nextPaths: RenderedParcelPath[] = [];

      parcelDataRef.current.features.forEach((feature, index) => {
        if (feature.geometry?.type !== 'Polygon') return;
        const parcel = feature as ParcelFeature;
        if (parcel.properties.status === 'rejected') return;

        try {
          const ring = normalizeLinearRing(parcel.geometry.coordinates[0]);
          nextPaths.push({
            key: String(parcel.id ?? parcel.properties.id ?? index),
            path: ringToScreenPath(map, ring),
            color: STATUS_COLOR[parcel.properties.status] ?? STATUS_COLOR.pending,
          });
        } catch {
          // Skip malformed polygons instead of breaking the whole map overlay.
        }
      });

      setParcelPaths(nextPaths);
      setEditPath(currentCoordsRef.current
        ? ringToScreenPath(map, currentCoordsRef.current)
        : null);
    }, []);

    // 1. Initialize Map
    useEffect(() => {
      if (mapRef.current || !mapContainer.current) return;

      let cancelled = false;
      let warningTimer: ReturnType<typeof setTimeout> | null = null;
      let usingFallbackStyle = false;
      setIsLoading(true);
      setMapReady(false);
      setBasemapWarning(null);

      const map = new maplibregl.Map({
        container: mapContainer.current,
        style: OPENFREEMAP_STYLE,
        center: [73.8567, 18.5204],
        zoom: 13,
      });

      mapRef.current = map;
      const failsafe = setTimeout(() => {
        if (cancelled || map.isStyleLoaded()) return;
        usingFallbackStyle = true;
        if (warningTimer) {
          clearTimeout(warningTimer);
          warningTimer = null;
        }
        setBasemapWarning('Primary basemap unavailable. Using OpenStreetMap fallback tiles.');
        map.setStyle(createFallbackStyle());
      }, 8000);

      const handleMapError = (event: maplibregl.ErrorEvent) => {
        if (cancelled) return;

        const message = event.error?.message ?? '';
        if (!/fetch|tile|sprite|glyph|network/i.test(message)) return;

        if (usingFallbackStyle) {
          setBasemapWarning('Some fallback map tiles are unavailable. Parcel data is unaffected.');
          return;
        }

        setBasemapWarning('Some basemap details could not load. Parcel data is unaffected.');
        if (warningTimer) clearTimeout(warningTimer);
        warningTimer = setTimeout(() => setBasemapWarning(null), 6000);
      };

      map.on('error', handleMapError);

      map.on('load', async () => {
        clearTimeout(failsafe);
        if (cancelled || mapRef.current !== map) return;

        const [geojson, imagery] = await Promise.all([fetchParcels(), fetchImagery()]);
        if (cancelled || mapRef.current !== map) return;

        parcelDataRef.current = geojson;
        imageryRef.current = imagery;
        ensureBackgroundLayers(map, geojson);
        ensureImageryLayers(map, imagery);
        ensureEditLayers(map);
        setImageryCount(imagery.length);

        setIsLoading(false);
        setMapReady(true);
        refreshSvgOverlay(map);
      });

      map.on('style.load', () => {
        if (cancelled || parcelDataRef.current.features.length === 0) return;
        ensureBackgroundLayers(map, parcelDataRef.current);
        ensureImageryLayers(map, imageryRef.current);
        ensureEditLayers(map);
        refreshSvgOverlay(map);
      });

      return () => {
        cancelled = true;
        clearTimeout(failsafe);
        if (warningTimer) clearTimeout(warningTimer);
        map.off('error', handleMapError);
        setMapReady(false);
        if (mapRef.current === map) {
          mapRef.current = null;
        }
        map.remove();
      };
    }, [fetchImagery, fetchParcels, refreshSvgOverlay]);

    // 2. Refresh Background Data
    useEffect(() => {
      if (!mapReady || !mapRef.current) return;
      const map = mapRef.current;
      
      (async () => {
        const [geojson, imagery] = await Promise.all([fetchParcels(), fetchImagery()]);
        if (!map.getStyle()) return;

        parcelDataRef.current = geojson;
        imageryRef.current = imagery;
        ensureImageryLayers(map, imagery);
        setImageryCount(imagery.length);

        const src = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (!src) {
          ensureBackgroundLayers(map, geojson);
          refreshSvgOverlay(map);
          return;
        }
        src.setData(geojson);
        refreshSvgOverlay(map);
      })();
    }, [mapReady, fetchImagery, fetchParcels, parcelVersion, refreshSvgOverlay]);

    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapReady || !map.getStyle()) return;
      try {
        setElevationLayer(map, elevationLayer);
        if (elevationLayer) {
          const [west, south, east, north] = elevationLayer.boundingBox;
          map.fitBounds([[west, south], [east, north]], { padding: 48, duration: 900 });
        }
      } catch (error) {
        console.warn('[WebGISMap] Could not display the nDSM layer:', error);
      }
    }, [elevationLayer, mapReady]);

    // Keep the SVG fallback synchronized with MapLibre camera movement.
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapReady) return;

      const refresh = () => refreshSvgOverlay(map);
      map.on('move', refresh);
      map.on('resize', refresh);
      refresh();

      return () => {
        map.off('move', refresh);
        map.off('resize', refresh);
      };
    }, [mapReady, refreshSvgOverlay]);

    // Select any parcel for reporting without depending on WebGL hit testing.
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapReady || !onParcelSelect) return;

      const handleClick = (event: maplibregl.MapMouseEvent) => {
        const clickedPoint: LngLatCoordinate = [event.lngLat.lng, event.lngLat.lat];
        const parcel = parcelDataRef.current.features.find(feature => {
          if (feature.geometry?.type !== 'Polygon') return false;
          const candidate = feature as ParcelFeature;
          if (candidate.properties.status === 'rejected') return false;
          try {
            return pointInRing(
              clickedPoint,
              normalizeLinearRing(candidate.geometry.coordinates[0])
            );
          } catch {
            return false;
          }
        }) as ParcelFeature | undefined;

        if (parcel) onParcelSelect(parcel);
      };

      map.on('click', handleClick);

      return () => {
        map.off('click', handleClick);
      };
    }, [mapReady, onParcelSelect]);

    // 3. Edit Engine & Markers
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapReady || !map.getStyle()) return;

      markersRef.current.forEach(m => m.remove());
      markersRef.current = [];

      ensureEditLayers(map);

      const getPolySource = () => map.getSource(EDIT_POLY_SOURCE) as maplibregl.GeoJSONSource | undefined;
      const getLineSource = () => map.getSource(EDIT_LINE_SOURCE) as maplibregl.GeoJSONSource | undefined;

      type LegacyParcelFeature = ParcelFeature & {
        geojson_geometry?: GeoJSON.Polygon | string;
      };
      let rawGeom: GeoJSON.Polygon | string | null =
        selectedParcel?.geometry ??
        (selectedParcel as LegacyParcelFeature | null | undefined)?.geojson_geometry ??
        null;
      if (typeof rawGeom === 'string') {
        try { rawGeom = JSON.parse(rawGeom) as GeoJSON.Polygon; } catch { rawGeom = null; }
      }

      if (!selectedParcel || !rawGeom || !rawGeom.coordinates || !rawGeom.coordinates[0]) {
        getPolySource()?.setData({ type: 'FeatureCollection', features: [] });
        getLineSource()?.setData({ type: 'FeatureCollection', features: [] });
        currentCoordsRef.current = null;
        setEditPath(null);
        return;
      }

      let ring: LngLatCoordinate[];
      try {
        ring = normalizeLinearRing(rawGeom.coordinates[0]);
      } catch (error) {
        console.warn('[WebGISMap] Invalid selected polygon:', error);
        currentCoordsRef.current = null;
        setEditPath(null);
        return;
      }

      currentCoordsRef.current = ring;

      const updateMapGeometry = (currentRing: LngLatCoordinate[]) => {
        const polySrc = getPolySource();
        const lineSrc = getLineSource();

        if (lineSrc) {
          lineSrc.setData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: currentRing },
              properties: {}
            }]
          });
        }

        if (polySrc) {
          polySrc.setData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              geometry: { type: 'Polygon', coordinates: [currentRing] },
              properties: {}
            }]
          });
        }

        setEditPath(ringToScreenPath(map, currentRing));
      };

      updateMapGeometry(ring);

      ring.forEach((coord, index) => {
        if (index === ring.length - 1) return;

        const el = document.createElement('div');
        el.className = 'w-4 h-4 bg-indigo-500 border-2 border-white rounded-full shadow-lg cursor-grab active:cursor-grabbing';
        el.style.zIndex = '3';

        const marker = new maplibregl.Marker({ element: el, draggable: true })
          .setLngLat([coord[0], coord[1]] as [number, number])
          .addTo(map);

        marker.on('drag', () => {
          const lngLat = marker.getLngLat();
          ring[index] = [lngLat.lng, lngLat.lat];
          if (index === 0) {
            ring[ring.length - 1] = [lngLat.lng, lngLat.lat];
          }
          updateMapGeometry(ring);
        });

        markersRef.current.push(marker);
      });

      return () => {
        markersRef.current.forEach(m => m.remove());
        markersRef.current = [];
      };
    }, [selectedParcel, mapReady]);

    // 4. Bulletproof "Fly To" Camera Logic
    useEffect(() => {
      const map = mapRef.current;
      if (!map || !mapReady || !currentCoordsRef.current) return;

      try {
        const lngs = currentCoordsRef.current.map(c => c[0]);
        const lats = currentCoordsRef.current.map(c => c[1]);
        map.flyTo({
          center: [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2],
          zoom: 18,
          duration: 1200,
        });
      } catch (e) {
        console.warn('Map flyTo failed:', e);
      }
    }, [selectedParcel, mapReady]);

    return (
      <div className="relative w-full h-full bg-slate-950">
        {isLoading && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/80">
            <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-white text-sm font-medium mt-2">Rendering Map View...</p>
          </div>
        )}

        <div ref={mapContainer} className="w-full h-full absolute inset-0" />

        <svg
          className="absolute inset-0 z-[2] w-full h-full pointer-events-none"
          aria-hidden="true"
        >
          {parcelPaths.map(parcelPath => (
            <path
              key={parcelPath.key}
              d={parcelPath.path}
              fill={parcelPath.color}
              fillOpacity="0.28"
              stroke={parcelPath.color}
              strokeOpacity="0.95"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {editPath && (
            <>
              <path
                d={editPath}
                fill="#6366F1"
                fillOpacity="0.36"
                stroke="#A5B4FC"
                strokeWidth="6"
                strokeOpacity="0.35"
                vectorEffect="non-scaling-stroke"
              />
              <path
                d={editPath}
                fill="none"
                stroke="#FFFFFF"
                strokeWidth="2.5"
                vectorEffect="non-scaling-stroke"
              />
            </>
          )}
        </svg>

        {basemapWarning && (
          <div className="absolute bottom-10 left-3 right-3 z-20 rounded-lg border border-amber-400/40 bg-slate-950/90 px-3 py-2 text-xs text-amber-200 shadow-xl backdrop-blur-sm sm:bottom-auto sm:left-auto sm:top-3 sm:max-w-xs">
            {basemapWarning}
          </div>
        )}

        {selectedParcel && !isLoading && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 bg-slate-900/95 border border-indigo-500/30 rounded-xl px-4 py-2.5 shadow-xl text-xs text-indigo-300 font-medium flex items-center gap-2 whitespace-nowrap">
            <span className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />
            Editing: <span className="font-mono text-indigo-200">{selectedParcel.properties?.id || 'Parcel'}</span>
            &nbsp;— drag blue vertex pins, then click &quot;Edit &amp; Save&quot; in sidebar
          </div>
        )}

        {!isLoading && (
          <div className="absolute top-3 left-3 z-10 w-48 max-w-[200px] bg-slate-900/90 backdrop-blur-sm border border-slate-700 rounded-xl p-3 shadow-xl">
            <div className="text-[10px] text-slate-400 uppercase tracking-widest font-semibold mb-2">Legend</div>
            {imageryCount > 0 && (
              <div className="flex items-center gap-3 mb-1.5 border-b border-slate-700 pb-1.5">
                <div className="w-3 h-3 rounded-sm flex-shrink-0 bg-cyan-300/70 ring-1 ring-cyan-200" />
                <span className="text-[10px] text-cyan-200">Drone imagery ({imageryCount})</span>
              </div>
            )}
            {elevationLayer && (
              <div className="mb-1.5 flex items-center gap-3 border-b border-slate-700 pb-1.5">
                <div className="h-3 w-3 flex-shrink-0 rounded-sm bg-gradient-to-r from-blue-500 via-yellow-400 to-red-500" />
                <span className="text-[10px] text-cyan-200">nDSM height layer</span>
              </div>
            )}
            {Object.entries(STATUS_COLOR).map(([s, c]) => (
              <div key={s} className="flex items-center gap-3 mb-1 last:mb-0">
                <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: c, opacity: 0.8 }} />
                <span className="text-[10px] text-slate-400 capitalize">{s.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }
);

WebGISMap.displayName = 'WebGISMap';
export default WebGISMap;
