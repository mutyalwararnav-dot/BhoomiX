'use client';

// app/page.tsx
// BhoomiX main map dashboard page

import dynamic from 'next/dynamic';
import { useState, Suspense } from 'react';
import type { ParcelFeature } from '@/lib/supabase';
import { supabase } from '@/lib/supabase';
import TriageSidebar from '../components/TriageSidebar';

// Dynamic import for WebGISMap — prevents SSR issues with maplibre-gl
const WebGISMap = dynamic(
  () => import('../components/map/WebGISMap'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-[#0B0F1A]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-slate-400 text-sm">Initializing WebGIS engine…</div>
        </div>
      </div>
    ),
  }
);

export default function HomePage() {
  const [editingParcel, setEditingParcel] = useState<ParcelFeature | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleSaveGeometry = async (id: string, newGeometry: GeoJSON.Polygon) => {
    setIsSaving(true);
    const { data, error } = await supabase.rpc('update_parcel_geometry', {
      p_id: id,
      p_new_geojson: newGeometry,
      p_changed_by: 'Surveyor_01'
    });
    
    if (error) {
      console.error('[BhoomiX] Failed to save geometry:', error);
      alert('Failed to save geometry: ' + error.message);
    } else {
      // Clear the editing parcel and trigger a sidebar refresh
      setEditingParcel(null);
      setRefreshTrigger(prev => prev + 1);
    }
    setIsSaving(false);
  };

  return (
    <div className="relative w-full h-full flex flex-col md:flex-row">
      {/* Surveyor Triage Sidebar (25% width on desktop) */}
      <div className="w-full md:w-1/4 h-1/3 md:h-full flex-shrink-0 z-20 shadow-2xl border-r border-[#2D3748]">
        <TriageSidebar onFlyTo={setEditingParcel} refreshTrigger={refreshTrigger} />
      </div>

      {/* Map — fills remaining 75% area */}
      <div className="flex-1 relative min-h-0 bg-[#0B0F1A] z-10">
        <Suspense fallback={null}>
          <WebGISMap
            editingParcel={editingParcel}
            onSaveGeometry={handleSaveGeometry}
            isSaving={isSaving}
          />
        </Suspense>
      </div>
    </div>
  );
}
