'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import type { ParcelFeature } from '@/lib/supabase';
import { Save } from 'lucide-react';

interface WebGISMapProps {
  editingParcel?: ParcelFeature | null;
  onSaveGeometry?: (id: string, newGeometry: GeoJSON.Polygon) => void;
  isSaving?: boolean;
}

export default function WebGISMap({ editingParcel, onSaveGeometry, isSaving }: WebGISMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const drawInstance = useRef<MapboxDraw | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Prevent double initialization
    if (mapInstance.current || !mapContainer.current) return;

    try {
      mapInstance.current = new maplibregl.Map({
        container: mapContainer.current,
        style: {
          version: 8,
          sources: {
            'osm-tiles': {
              type: 'raster',
              tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
              tileSize: 256,
              attribution: '&copy; OpenStreetMap'
            }
          },
          layers: [{
            id: 'osm-layer',
            type: 'raster',
            source: 'osm-tiles',
            minzoom: 0,
            maxzoom: 19
          }]
        },
        center: [73.8567, 18.5204], // Centered on Pune
        zoom: 14,
      });

      // Initialize Mapbox Draw
      const draw = new MapboxDraw({
        displayControlsDefault: false,
        controls: {
          polygon: false,
          trash: false
        },
        defaultMode: 'simple_select'
      });
      drawInstance.current = draw;
      
      // Add draw control to map
      mapInstance.current.addControl(draw as unknown as maplibregl.IControl, 'top-left');

      mapInstance.current.on('load', () => {
        console.log('MapLibre loaded successfully');
        setIsLoading(false);
      });

      mapInstance.current.on('error', (e) => {
        console.error('MapLibre error:', e);
      });
    } catch (error) {
      console.error('Error initializing map:', error);
    }

    // MANUAL FAILSAFE: Force the spinner off after 3 seconds no matter what
    const failsafe = setTimeout(() => {
      console.log('Failsafe triggered: forcing spinner off');
      setIsLoading(false);
    }, 3000);

    return () => {
      clearTimeout(failsafe);
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // Sync editing parcel and Fly To
  useEffect(() => {
    if (!mapInstance.current || !drawInstance.current) return;

    // Clear any existing drawings
    drawInstance.current.deleteAll();

    if (editingParcel) {
      // Add the parcel to the draw instance
      drawInstance.current.add(editingParcel);
      
      // Select it for editing
      if (editingParcel.id) {
        drawInstance.current.changeMode('direct_select', { featureId: editingParcel.id as string });
      }

      // Calculate Bounding Box to Fly To
      if (editingParcel.geometry && editingParcel.geometry.coordinates && editingParcel.geometry.coordinates[0]) {
        const coords = editingParcel.geometry.coordinates[0];
        const bounds = coords.reduce(
          (acc, coord) => [
            [Math.min(acc[0][0], coord[0]), Math.min(acc[0][1], coord[1])],
            [Math.max(acc[1][0], coord[0]), Math.max(acc[1][1], coord[1])]
          ],
          [[Infinity, Infinity], [-Infinity, -Infinity]]
        ) as [[number, number], [number, number]];
        
        mapInstance.current.fitBounds(bounds, { padding: 80, duration: 1500 });
      }
    }
  }, [editingParcel]);

  const handleSave = () => {
    if (!drawInstance.current || !editingParcel || !onSaveGeometry) return;
    
    // Get the updated geometry from Mapbox Draw
    const data = drawInstance.current.getAll();
    if (data.features.length > 0) {
      const updatedFeature = data.features[0];
      onSaveGeometry(editingParcel.properties.id, updatedFeature.geometry as GeoJSON.Polygon);
    }
  };

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', backgroundColor: '#0f172a' }}>
      
      {/* Loading Spinner overlay */}
      {isLoading && (
        <div 
          style={{ 
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', 
            alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a', zIndex: 50 
          }}
        >
          <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-white text-lg font-semibold tracking-wide">Forcing Map Load...</p>
        </div>
      )}

      {/* Map Container */}
      <div ref={mapContainer} style={{ width: '100%', height: '100%' }} />
      
      {/* Save Action Panel */}
      {editingParcel && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 bg-[#111827]/95 border border-[#2D3748] rounded-xl shadow-2xl p-4 flex items-center gap-4 animate-fade-in backdrop-blur-sm">
          <div>
            <div className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-0.5">Editing Parcel</div>
            <div className="text-sm font-mono text-slate-200">{editingParcel.properties.id}</div>
          </div>
          <div className="w-px h-8 bg-[#2D3748]"></div>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-indigo-600/50 text-white rounded-lg font-semibold transition-all shadow-bhoomix-sm"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            {isSaving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  );
}