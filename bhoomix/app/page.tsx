'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import dynamic from 'next/dynamic';
import TriageSidebar from '@/components/TriageSidebar';
import UploadModal, { type UploadSuccessDetails } from '@/components/UploadModal';
import ExportReportModal from '@/components/ExportReportModal';
import FeedbackSyncButton from '@/components/FeedbackSyncButton';
import UserMenu from '@/components/auth/UserMenu';
import { useAuth } from '@/components/auth/AuthProvider';
import ActivityHistoryModal from '@/components/ActivityHistoryModal';
import DatasetReadinessModal from '@/components/DatasetReadinessModal';
import ProcessingJobsModal, { type ProcessingJob } from '@/components/ProcessingJobsModal';
import ImageAnalysisModal from '@/components/ImageAnalysisModal';
import ThemeToggle from '@/components/ThemeToggle';
import { BrainCircuit, FileImage, History, Layers3, ListChecks, Loader2, MapPin, ScanSearch, Sparkles, Upload, X } from 'lucide-react';
import type { WebGISMapHandle } from '@/components/map/WebGISMap';
import type { ParcelFeature } from '@/lib/supabase';
import { apiFetch } from '@/lib/api-fetch';

// Dynamically import map to prevent SSR window issues
const WebGISMap = dynamic(() => import('@/components/map/WebGISMap'), { ssr: false });

function Dashboard() {
  const mapRef = useRef<WebGISMapHandle>(null);
  const { profile } = useAuth();

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
  const [latestUpload, setLatestUpload] = useState<UploadSuccessDetails | null>(null);
  const [analysisImageUrl, setAnalysisImageUrl] = useState<string | null>(null);
  const [isAnalysisOpen, setIsAnalysisOpen] = useState(false);
  const [analysisLoading, setAnalysisLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (analysisImageUrl) URL.revokeObjectURL(analysisImageUrl);
    };
  }, [analysisImageUrl]);

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

  const openStoredAnalysis = useCallback(async (requestedJob?: ProcessingJob) => {
    if (analysisImageUrl && latestUpload?.fileKind === 'imagery' && (!requestedJob || requestedJob.upload?.id === latestUpload.uploadId)) {
      setIsJobsOpen(false);
      setIsAnalysisOpen(true);
      return;
    }

    setAnalysisLoading(true);
    try {
      let job = requestedJob;
      if (!job) {
        if (!profile) {
          throw new Error('Upload an image in this browser session first. Sign in to reopen earlier stored uploads.');
        }
        const jobsResponse = await apiFetch('/api/processing-jobs', { cache: 'no-store' });
        const jobsPayload = await jobsResponse.json() as { jobs?: ProcessingJob[]; error?: string };
        if (!jobsResponse.ok) throw new Error(jobsPayload.error || 'Stored uploads could not be loaded.');
        job = jobsPayload.jobs?.find((candidate) => candidate.status === 'completed' && candidate.upload?.id);
      }
      if (!job?.upload?.id) throw new Error('No completed imagery upload is available. Upload an image first.');

      const previewResponse = await apiFetch(`/api/imagery/${job.upload.id}/preview`, { cache: 'no-store' });
      if (!previewResponse.ok) {
        const payload = await previewResponse.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || 'The stored image preview could not be loaded.');
      }
      const previewBlob = await previewResponse.blob();
      const previewUrl = URL.createObjectURL(previewBlob);
      setAnalysisImageUrl(previewUrl);
      setLatestUpload({
        uploadId: job.upload.id,
        filename: job.upload.filename,
        fileKind: 'imagery',
        parcelCount: job.parcel_count,
        imageAnnotationCount: job.parcel_count,
        jobId: job.id,
        processingMode: job.processing_mode,
        isGeoreferenced: false,
        sourceFile: null,
      });
      setIsJobsOpen(false);
      setIsAnalysisOpen(true);
    } catch (error: unknown) {
      setUploadNotice(error instanceof Error ? error.message : 'Image Analysis could not be opened.');
    } finally {
      setAnalysisLoading(false);
    }
  }, [analysisImageUrl, latestUpload, profile]);

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
    <main className="bhoomix-theme-surface bhoomix-app-shell flex h-dvh w-screen flex-col overflow-hidden font-sans text-slate-100 md:flex-row">
      {/* Left Sidebar: Triage & Workflow */}
      <div className="bhoomix-glass z-20 flex h-[46dvh] w-full flex-shrink-0 flex-col border-r shadow-2xl md:h-full md:w-[400px]">
        <div className="flex min-h-16 shrink-0 items-center justify-between border-b border-slate-700/60 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-indigo-400/35 bg-gradient-to-br from-indigo-500/30 via-violet-500/15 to-cyan-400/20 text-indigo-200 shadow-lg shadow-indigo-950/30">
              <Layers3 className="h-5 w-5" />
              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_8px_#67e8f9]" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2"><h1 className="text-base font-extrabold tracking-tight text-white">BhoomiX</h1><span className="rounded-full border border-indigo-400/25 bg-indigo-400/10 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[0.14em] text-indigo-200">AI GIS</span></div>
              <p className="truncate text-[10px] font-medium tracking-wide text-slate-500">Cadastral intelligence workspace</p>
            </div>
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
        <div className="bhoomix-topbar z-10 flex min-h-16 shrink-0 items-center justify-between gap-3 border-b px-2 py-2 sm:px-4 lg:px-5">
          <div className="hidden min-w-0 items-center gap-3 2xl:flex">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300"><MapPin className="h-4 w-4" /></div>
            <div><p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">Operations map</p><p className="text-xs font-semibold text-slate-200">Pune, Maharashtra</p></div>
            <div className="ml-2 flex items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[10px] font-bold text-emerald-300">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400 shadow-[0_0_7px_#34d399]" /> PostGIS live
            </div>
          </div>

          <div className="flex w-full flex-nowrap items-center justify-start gap-1.5 overflow-x-auto py-1 sm:gap-2 2xl:w-auto 2xl:justify-end">
            <ThemeToggle />
            <UserMenu />
            <button
              type="button"
              onClick={() => void openStoredAnalysis()}
              disabled={analysisLoading}
              className="bhoomix-toolbar-button border-cyan-500/30 text-cyan-200 disabled:cursor-wait"
            >
              {analysisLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">Image Analysis</span>
              <span className="sm:hidden">Analyze</span>
            </button>
            <button
              type="button"
              onClick={() => setIsJobsOpen(true)}
              className="bhoomix-toolbar-button"
            >
              <ListChecks className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Uploads &amp; Jobs</span>
              <span className="sm:hidden">Jobs</span>
            </button>
            <button
              type="button"
              onClick={() => setIsActivityOpen(true)}
              className="bhoomix-toolbar-button"
            >
              <History className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Activity</span>
            </button>
            <button
              type="button"
              onClick={() => setIsDatasetOpen(true)}
              className="bhoomix-toolbar-button"
            >
              <BrainCircuit className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Dataset</span>
            </button>
            <button
              onClick={() => setIsExportOpen(true)}
              disabled={!selectedParcel}
              title={selectedParcel ? 'Export selected parcel report' : 'Select a parcel on the map first'}
              className="bhoomix-toolbar-button"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Export Report</span>
              <span className="sm:hidden">Export</span>
            </button>
            <button
              onClick={() => setIsUploadOpen(true)}
              className="bhoomix-primary-action order-first sm:order-none"
            >
              <Upload className="h-3.5 w-3.5" /> Upload Data
            </button>
          </div>
        </div>

        {/* Map Viewport */}
        <div className="bhoomix-map-frame relative m-2 min-h-0 flex-1 overflow-hidden bg-slate-950 md:ml-0 md:mt-2">
          <WebGISMap
            ref={mapRef}
            selectedParcel={editingParcelId ? selectedParcel : null}
            parcelVersion={parcelVersion}
            onParcelSelect={handleMapParcelSelect}
          />
          {latestUpload && (
            <aside className="bhoomix-glass absolute bottom-4 right-4 z-20 w-[min(24rem,calc(100%-2rem))] rounded-2xl border border-cyan-400/25 p-4 shadow-2xl">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300">
                  <FileImage className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-cyan-300">Latest upload</p>
                  <p className="mt-1 truncate text-sm font-semibold text-white" title={latestUpload.filename}>{latestUpload.filename}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {latestUpload.processingMode === 'demo'
                      ? 'Ready for manual boundary review'
                      : `${(latestUpload.imageAnnotationCount ?? 0) + latestUpload.parcelCount} model boundar${(latestUpload.imageAnnotationCount ?? 0) + latestUpload.parcelCount === 1 ? 'y' : 'ies'} detected`}
                    {latestUpload.jobId ? ` · Job ${latestUpload.jobId.slice(0, 8)}` : ''}
                  </p>
                  {latestUpload.fileKind === 'imagery' && !latestUpload.isGeoreferenced && (
                    <p className="mt-2 text-xs leading-relaxed text-amber-300">This image has no map coordinates, so it cannot appear as a map overlay. Use a georeferenced GeoTIFF for accurate placement.</p>
                  )}
                  {latestUpload.fileKind === 'imagery' && (
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                      {analysisImageUrl && <button type="button" onClick={() => setIsAnalysisOpen(true)} className="text-xs font-semibold text-cyan-300 hover:text-cyan-200">Open image analysis →</button>}
                      <button type="button" onClick={() => setIsJobsOpen(true)} className="text-xs font-semibold text-indigo-300 hover:text-indigo-200">Upload details →</button>
                    </div>
                  )}
                </div>
                <button type="button" onClick={() => setLatestUpload(null)} title="Dismiss latest upload" className="rounded-lg p-1 text-slate-500 hover:bg-slate-800 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* Modals */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onViewJobs={() => setIsJobsOpen(true)}
        onOpenAnalysis={() => setIsAnalysisOpen(true)}
        onUploadSuccess={(result) => {
          setParcelVersion(v => v + 1);
          setLatestUpload(result);
          if (result.sourceFile) setAnalysisImageUrl(URL.createObjectURL(result.sourceFile));
          const detectedCount = result.parcelCount + (result.imageAnnotationCount ?? 0);
          setUploadNotice(result.processingMode === 'demo'
            ? `${result.filename}: uploaded and ready for manual boundary review.`
            : `${result.filename}: ${detectedCount} model boundar${detectedCount === 1 ? 'y' : 'ies'} detected.`);
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
        <ProcessingJobsModal recentUpload={latestUpload} onClose={() => setIsJobsOpen(false)} onAnalyze={(job) => void openStoredAnalysis(job)} />
      )}

      {isAnalysisOpen && latestUpload?.fileKind === 'imagery' && analysisImageUrl && (
        <ImageAnalysisModal
          key={`${latestUpload.uploadId ?? 'local'}:${analysisImageUrl}`}
          uploadId={latestUpload.uploadId}
          filename={latestUpload.filename}
          imageUrl={analysisImageUrl}
          processingMode={latestUpload.processingMode}
          onClose={() => setIsAnalysisOpen(false)}
        />
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
