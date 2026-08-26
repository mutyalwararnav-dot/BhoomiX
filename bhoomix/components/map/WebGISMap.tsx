'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

interface WebGISMapProps {
  selectedParcel?: any;
}

export default function WebGISMap({ selectedParcel }: WebGISMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapInstance = useRef<maplibregl.Map | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // 1. Initialize Map
  useEffect(() => {
    if (mapInstance.current || !mapContainer.current) return;

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
      center: [73.8567, 18.5204], // Pune Center
      zoom: 13,
    });

    mapInstance.current.on('load', () => {
      setIsLoading(false);
      mapInstance.current?.resize();
    });

    return () => {
      if (mapInstance.current) {
        mapInstance.current.remove();
        mapInstance.current = null;
      }
    };
  }, []);

  // 2. The "Fly To" Camera Logic
  useEffect(() => {
    // If the map isn't ready or no parcel is selected, do nothing.
    if (!mapInstance.current || !selectedParcel?.geometry?.coordinates) return;

    try {
      // Forcefully flatten the geometry array to find the raw numbers
      const flatCoords = selectedParcel.geometry.coordinates.flat(Infinity);
      
      if (flatCoords.length >= 2) {
        const lng = flatCoords[0];
        const lat = flatCoords[1];
        
        // Safety check: Only fly if we successfully extracted valid numbers
        if (!isNaN(lng) && !isNaN(lat)) {
          mapInstance.current.flyTo({
            center: [lng, lat],
            zoom: 18,
            essential: true,
            duration: 1500 // 1.5 seconds smooth animation
          });
        }
      }
    } catch (e) {
      console.error('Fly to error:', e);
    }
  }, [selectedParcel]); // <--- This tells the map to re-run whenever a new parcel is clicked!

  return (
    <div className="relative w-full h-full bg-slate-950">
      {isLoading && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/80">
          <div className="w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3"></div>
          <p className="text-white text-sm font-medium">Rendering Map View...</p>
        </div>
      )}
      <div ref={mapContainer} className="w-full h-full absolute inset-0" />
    </div>
  );
}