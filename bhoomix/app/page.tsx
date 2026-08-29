'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import TriageSidebar from '@/components/TriageSidebar';
import UploadModal from '@/components/UploadModal';
import ExportReportModal from '@/components/ExportReportModal';
import FeedbackSyncButton from '@/components/FeedbackSyncButton';
import UserMenu from '@/components/auth/UserMenu';
import ActivityHistoryModal from '@/components/ActivityHistoryModal';
import DatasetReadinessModal from '@/components/DatasetReadinessModal';
import ProcessingJobsModal from '@/components/ProcessingJobsModal';
import { BrainCircuit, History, ListChecks } from 'lucide-react';
import type { WebGISMapHandle } from '@/components/map/WebGISMap';
import type { ParcelFeature } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';

// Dynamically import map to prevent SSR window issues
const WebGISMap = dynamic(() => import('@/components/map/WebGISMap'), { ssr: false });

function Dashboard() {
  const mapRef = useRef<WebGISMapHandle>(null);

  const [selectedParcel, setSelectedParcel] = useState<ParcelFeature | null>(null);
  const [editingParcelId, setEditingParcelId] = useState<string | null>(null);
  const [parcelVersion, setParcelVersion] = useState(0);

  // Modals state
  const [isUploadOpen, setIsUploadOpen] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isActivityOpen, setIsActivityOpen] = useState(false);
  const [isDatasetOpen, setIsDatasetOpen] = useState(false);
  const [isJobsOpen, setIsJobsOpen] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!uploadNotice) return;
    const timeout = window.setTimeout(() => setUploadNotice(null), 3500);
    return () => window.clearTimeout(timeout);
  }, [uploadNotice]);

  // Handle Fly To & activate drawing/editing mode
  const handleFlyTo = (parcel: ParcelFeature | null) => {
    setSelectedParcel(parcel);
    setEditingParcelId(parcel ? parcel.properties.id : null);
  };

  const handleMapParcelSelect = useCallback((parcel: ParcelFeature) => {
    setSelectedParcel(parcel);
    setEditingParcelId(null);
  }, []);

  // Fully robust and safe Edit & Save handler
  const handleEditSave = async (parcelId: string) => {
    const editedGeometry = mapRef.current?.getEditedGeometry?.();
    if (!editedGeometry) {
      throw new Error('No edited geometry found on map. Please modify the boundary pins first.');
    }

    const response = await apiFetch('/api/edit-parcel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parcel_id: parcelId,
        geojson_geometry: editedGeometry, // <-- Changed to match the backend!
      }),
    });

    if (!response.ok) {
      let errorMessage = `Server status: ${response.status}`;
      try {
        const errorData = await response.json();
        if (errorData?.error) {
          errorMessage = errorData.error;
        }
      } catch  {
        const textFallback = await response.text();
        if (textFallback) errorMessage = textFallback;
      }
      throw new Error(errorMessage);
    }

    // Success - clear state and update map
    setSelectedParcel(null);
    setEditingParcelId(null);
    setParcelVersion(v => v + 1);
  };

  return (
    <main className="flex h-dvh w-screen flex-col overflow-hidden bg-slate-950 text-slate-100 font-sans md:flex-row">
      {/* Left Sidebar: Triage & Workflow */}
      <div className="z-20 flex h-[44dvh] w-full flex-shrink-0 flex-col shadow-2xl md:h-full md:w-[380px]">
        <div className="p-3 bg-[#0B0F1A] border-b border-[#2D3748] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-indigo-500 animate-pulse" />
            <h1 className="text-sm font-bold tracking-wide text-white">BhoomiX</h1>
          </div>
          <div className="flex items-center gap-2">
            <FeedbackSyncButton />
          </div>
        </div>

        <div className="flex-1 overflow-hidden">
          <TriageSidebar
            onFlyTo={handleFlyTo}
            onEditSave={handleEditSave}
            editingParcelId={editingParcelId}
            refreshTrigger={parcelVersion}
            onParcelStatusChange={() => setParcelVersion(v => v + 1)}
            onValidationComplete={() => setParcelVersion(v => v + 1)}
          />
        </div>
      </div>

      {/* Main Map Canvas Area */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top Header Bar */}
        <div className="z-10 flex min-h-14 shrink-0 items-center justify-between gap-2 border-b border-slate-800 bg-slate-900/90 px-2 py-2 backdrop-blur-md sm:px-4 lg:px-6">
          <div className="hidden items-center gap-4 text-xs font-medium text-slate-400 lg:flex">
            <span className="text-emerald-400 flex items-center gap-1.5 font-semibold">
              <span className="w-2 h-2 rounded-full bg-emerald-500" /> PostGIS Connected
            </span>
            <span>•</span>
            <span>OpenFreeMap</span>
            <span>•</span>
            <span className="text-slate-200">Pune, Maharashtra</span>
          </div>

          <div className="flex w-full flex-wrap items-center justify-end gap-1.5 sm:gap-2 lg:w-auto lg:gap-3">
            <UserMenu />
            <button
              type="button"
              onClick={() => setIsJobsOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 shadow-md transition-all hover:bg-slate-700 sm:px-3"
            >
              <ListChecks className="h-3.5 w-3.5" />
              Jobs
            </button>
            <button
              type="button"
              onClick={() => setIsActivityOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 shadow-md transition-all hover:bg-slate-700 sm:px-3"
            >
              <History className="h-3.5 w-3.5" />
              Activity
            </button>
            <button
              type="button"
              onClick={() => setIsDatasetOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 shadow-md transition-all hover:bg-slate-700 sm:px-3"
            >
              <BrainCircuit className="h-3.5 w-3.5" />
              Dataset
            </button>
            <button
              onClick={() => setIsExportOpen(true)}
              disabled={!selectedParcel}
              title={selectedParcel ? 'Export selected parcel report' : 'Select a parcel on the map first'}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-200 shadow-md transition-all hover:bg-slate-700 sm:px-3"
            >
              Export Report
            </button>
            <button
              onClick={() => setIsUploadOpen(true)}
              className="order-first rounded-lg bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white shadow-md transition-all hover:bg-indigo-500 sm:order-none sm:px-3"
            >
              UPLOAD DATA
            </button>
          </div>
        </div>

        {/* Map Viewport */}
        <div className="relative min-h-0 w-full flex-1">
          <WebGISMap
            ref={mapRef}
            selectedParcel={editingParcelId ? selectedParcel : null}
            parcelVersion={parcelVersion}
            onParcelSelect={handleMapParcelSelect}
          />
        </div>
      </div>

      {/* Modals */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploadSuccess={(count) => {
          setParcelVersion(v => v + 1);
          setUploadNotice(`${count} AI parcel${count === 1 ? '' : 's'} uploaded successfully.`);
        }}
      />

      <ExportReportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        parcel={selectedParcel}  // <-- Fixed!
      />

      {isActivityOpen && (
        <ActivityHistoryModal onClose={() => setIsActivityOpen(false)} />
      )}

      {isDatasetOpen && (
        <DatasetReadinessModal onClose={() => setIsDatasetOpen(false)} />
      )}

      {isJobsOpen && (
        <ProcessingJobsModal onClose={() => setIsJobsOpen(false)} />
      )}

      {uploadNotice && (
        <div
          role="status"
          className="fixed top-5 left-1/2 z-[70] -translate-x-1/2 rounded-xl border border-emerald-400/30 bg-emerald-950/95 px-4 py-3 text-sm font-semibold text-emerald-200 shadow-2xl backdrop-blur"
        >
          {uploadNotice}
        </div>
      )}
    </main>
  );
}

export default function Home() {
  return <Dashboard />;
}
