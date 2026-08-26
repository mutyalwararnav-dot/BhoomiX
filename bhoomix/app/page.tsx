'use client';

import { useState } from 'react';
import TriageSidebar from '@/components/TriageSidebar';
import WebGISMap from '@/components/map/WebGISMap';

export default function Home() {
  // This state is the bridge! It holds the parcel you click in the sidebar.
  const [selectedParcel, setSelectedParcel] = useState<any>(null);

  return (
    <div className="flex w-full h-full relative">
      {/* Left Side: Triage Queue (z-10 ensures it stays above the map) */}
      <div className="w-[400px] flex-shrink-0 border-r border-slate-800 bg-slate-900/50 flex flex-col z-10 shadow-2xl relative">
        {/* When 'Fly To' is clicked, it updates the selectedParcel state */}
        <TriageSidebar onFlyTo={setSelectedParcel} />
      </div>
      
      {/* Right Side: Main Map Canvas (z-0 ensures it doesn't block sidebar clicks) */}
      <div className="flex-1 relative z-0">
        {/* The Map listens to selectedParcel and moves the camera */}
        <WebGISMap selectedParcel={selectedParcel} />
      </div>
    </div>
  );
}