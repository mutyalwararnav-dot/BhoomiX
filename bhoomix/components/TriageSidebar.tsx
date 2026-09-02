'use client';

import { useEffect, useState } from 'react';
import type { ParcelFeature } from '@/lib/supabase';
import { ArrowRight, Building2, Check, Cpu, Crosshair, FileImage, ListChecks, Loader2, PenLine, ScanSearch, Search, ShieldAlert, UploadCloud, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { fetchActiveParcels } from '@/lib/parcels-client';
import type { UploadSuccessDetails } from '@/components/UploadModal';

interface TriageSidebarProps {
  onFlyTo?: (parcel: ParcelFeature | null) => void;
  onParcelStatusChange?: () => void;
  onEditSave?: (parcelId: string) => Promise<void>;
  editingParcelId?: string | null;
  refreshTrigger?: number;
  onValidationComplete?: (conflictCount: number) => void;
  referenceBuildingCount?: number;
  recentUpload?: UploadSuccessDetails | null;
  onUploadData?: () => void;
  onOpenAnalysis?: () => void;
  onOpenJobs?: () => void;
}

export default function TriageSidebar({
  onFlyTo,
  onParcelStatusChange,
  onEditSave,
  editingParcelId,
  refreshTrigger = 0,
  onValidationComplete,
  referenceBuildingCount = 0,
  recentUpload,
  onUploadData,
  onOpenAnalysis,
  onOpenJobs,
}: TriageSidebarProps) {
  const [parcels, setParcels]          = useState<ParcelFeature[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [isValidating, setIsValidating] = useState(false);
  const [validationNotice, setValidationNotice] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [queueFilter, setQueueFilter] = useState<'all' | 'conflict' | 'ai_suggestion'>('all');
  const [legacyHiddenCount, setLegacyHiddenCount] = useState(0);
  const [modelHealth, setModelHealth] = useState<{ available: boolean; model: string | null } | null>(null);

  const replaceParcels = (payload: Awaited<ReturnType<typeof fetchActiveParcels>>) => {
    const triageParcels = (payload.geojson.features as ParcelFeature[]).filter(
      (feature) => feature.properties.status === 'ai_suggestion' || feature.properties.status === 'conflict'
    );
    setParcels(triageParcels);
    setLegacyHiddenCount(payload.legacyHiddenCount);
  };

  useEffect(() => {
    async function loadParcels() {
      setIsLoading(true);
      try {
        replaceParcels(await fetchActiveParcels());
      } catch (error) {
        console.error('[BhoomiX] Sidebar fetch error:', error);
        setParcels([]);
      }
      setIsLoading(false);
    }
    loadParcels();
  }, [refreshTrigger]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await apiFetch('/api/model-health', { cache: 'no-store' });
        const payload = await response.json() as { available?: boolean; model?: string | null };
        if (active) setModelHealth({ available: payload.available === true, model: payload.model ?? null });
      } catch {
        if (active) setModelHealth({ available: false, model: null });
      }
    })();
    return () => { active = false; };
  }, []);

  const handleValidate = async () => {
    setIsValidating(true);
    setValidationNotice(null);
    try {
      const res  = await apiFetch('/api/validate-parcels', { method: 'POST', body: '{}' });
      const data = await res.json() as { conflict_count?: number; error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? `Validation failed with status ${res.status}`);
      }
      const count: number = data.conflict_count ?? 0;
      onValidationComplete?.(count);
      setValidationNotice({
        kind: 'success',
        message: count === 0
          ? 'Validation complete — no overlaps found.'
          : `Validation complete — ${count} overlap${count === 1 ? '' : 's'} found.`,
      });

      replaceParcels(await fetchActiveParcels());
    } catch (e) {
      console.error('[TriageSidebar] Validation error:', e);
      setValidationNotice({
        kind: 'error',
        message: e instanceof Error ? e.message : 'Spatial validation failed.',
      });
    } finally {
      setIsValidating(false);
    }
  };

  const handleDecision = async (parcelId: string, newStatus: 'confirmed' | 'rejected') => {
    const response = await apiFetch('/api/update-parcel', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ parcel_id: parcelId, new_status: newStatus }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(payload?.error ?? `Parcel update failed with status ${response.status}`);
    }

    setParcels(prev => prev.filter(p => p.properties.id !== parcelId));
    onParcelStatusChange?.();
    if (editingParcelId === parcelId) onFlyTo?.(null);
  };

  const handleEditSaveSuccess = (parcelId: string) => {
    setParcels(prev => prev.filter(p => p.properties.id !== parcelId));
    onParcelStatusChange?.();
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const visibleParcels = parcels.filter((parcel) => {
    if (queueFilter !== 'all' && parcel.properties.status !== queueFilter) return false;
    if (!normalizedQuery) return true;
    return [
      parcel.properties.id,
      parcel.properties.land_use,
      parcel.properties.status,
    ].some((value) => String(value ?? '').toLowerCase().includes(normalizedQuery));
  });
  const aiSuggestions = visibleParcels.filter(p => p.properties.status === 'ai_suggestion');
  const conflicts     = visibleParcels.filter(p => p.properties.status === 'conflict');
  const totalConflicts = parcels.filter(p => p.properties.status === 'conflict').length;
  const totalSuggestions = parcels.filter(p => p.properties.status === 'ai_suggestion').length;

  return (
    <div className="bhoomix-queue-shell z-20 flex h-full w-full flex-col overflow-hidden bg-gradient-to-b from-[#101827]/95 to-[#0a101c]/95">
      <div className="bhoomix-queue-header shrink-0 border-b border-slate-700/55 bg-slate-950/35 p-4 backdrop-blur-xl">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-indigo-300/80">Survey operations</p>
            <h2 className="mt-1 text-xl font-extrabold tracking-tight text-white">Review queue</h2>
            <p className="mt-1 text-[11px] text-slate-500">Validate suggestions and resolve boundary conflicts</p>
          </div>
          <button
            onClick={handleValidate}
            disabled={isValidating}
            title="Run spatial overlap validation now"
            className="mt-0.5 flex shrink-0 items-center gap-1.5 rounded-xl border border-indigo-400/25 bg-indigo-400/10 px-3 py-2 text-[11px] font-bold text-indigo-200 shadow-sm transition hover:border-indigo-400/50 hover:bg-indigo-400/20 disabled:opacity-50"
          >
            {isValidating
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <ScanSearch className="w-3 h-3" />
            }
            {isValidating ? 'Scanning…' : 'Validate'}
          </button>
        </div>
        {validationNotice && (
          <div
            role={validationNotice.kind === 'error' ? 'alert' : 'status'}
            className={`mt-3 rounded-lg border px-3 py-2 text-[11px] font-medium ${
              validationNotice.kind === 'error'
                ? 'border-rose-500/30 bg-rose-500/10 text-rose-300'
                : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
            }`}
          >
            {validationNotice.message}
          </div>
        )}
        <div className="mt-4 space-y-2.5">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search parcel ID or land use"
              className="bhoomix-queue-search w-full rounded-xl border border-slate-700/70 bg-slate-900/75 py-2.5 pl-9 pr-3 text-xs text-slate-200 shadow-inner outline-none transition placeholder:text-slate-600 focus:border-cyan-400/45 focus:ring-2 focus:ring-cyan-400/10"
            />
          </label>
          <div className="bhoomix-filter-bar grid grid-cols-3 gap-1 rounded-xl border border-slate-800/80 bg-slate-950/55 p-1">
            {[
              { value: 'all', label: `All ${parcels.length}` },
              { value: 'conflict', label: `Conflicts ${totalConflicts}` },
              { value: 'ai_suggestion', label: `AI ${totalSuggestions}` },
            ].map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setQueueFilter(filter.value as typeof queueFilter)}
                className={`rounded-lg px-2 py-1.5 text-[10px] font-bold transition-all ${
                  queueFilter === filter.value
                    ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-950/40'
                    : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bhoomix-queue-scroll flex-1 space-y-6 overflow-y-auto bg-[radial-gradient(circle_at_20%_0%,rgba(99,102,241,0.08),transparent_18rem)] p-4">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {(queueFilter === 'all' || queueFilter === 'conflict') && <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]" />
                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                  Conflicts ({conflicts.length})
                </h3>
              </div>
              <div className="space-y-3">
                {conflicts.map(parcel => (
                  <ParcelCard
                    key={parcel.properties.id}
                    parcel={parcel}
                    isEditing={editingParcelId === parcel.properties.id}
                    onFlyTo={onFlyTo}
                    onDecision={handleDecision}
                    onEditSave={onEditSave}
                    onEditSaveSuccess={handleEditSaveSuccess}
                  />
                ))}
                {conflicts.length === 0 && totalConflicts === 0 && !normalizedQuery && (
                  <div className="text-xs text-slate-500 italic">No conflicts pending review.</div>
                )}
              </div>
            </div>}

            {(queueFilter === 'all' || queueFilter === 'ai_suggestion') && <div>
              <div className="mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-400 shadow-[0_0_8px_rgba(251,191,36,0.75)]" />
                <h3 className="text-[11px] font-bold uppercase tracking-[0.15em] text-slate-300">
                  AI Suggestions ({aiSuggestions.length})
                </h3>
              </div>
              <div className="space-y-3">
                {aiSuggestions.map(parcel => (
                  <ParcelCard
                    key={parcel.properties.id}
                    parcel={parcel}
                    isEditing={editingParcelId === parcel.properties.id}
                    onFlyTo={onFlyTo}
                    onDecision={handleDecision}
                    onEditSave={onEditSave}
                    onEditSaveSuccess={handleEditSaveSuccess}
                  />
                ))}
                {aiSuggestions.length === 0 && totalSuggestions === 0 && !normalizedQuery && (
                  <div className="text-xs text-slate-500 italic">No AI suggestions pending review.</div>
                )}
              </div>
            </div>}

            {visibleParcels.length === 0 && parcels.length > 0 && (
              <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center">
                <Search className="mx-auto mb-2 h-5 w-5 text-slate-600" />
                <p className="text-xs font-medium text-slate-400">No matching parcels</p>
                <button type="button" onClick={() => { setSearchQuery(''); setQueueFilter('all'); }} className="mt-2 text-[11px] font-semibold text-indigo-300 hover:text-indigo-200">Clear search and filters</button>
              </div>
            )}

            {parcels.length === 0 && legacyHiddenCount > 0 && (
              <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/5 px-4 py-4 text-xs leading-5 text-slate-400">
                {legacyHiddenCount} legacy demo/test parcel{legacyHiddenCount === 1 ? ' is' : 's are'} hidden because they are not linked to verified geospatial imagery. Upload georeferenced GeoJSON or run the model on a georeferenced GeoTIFF to populate this queue accurately.
              </div>
            )}

            {parcels.length === 0 && !normalizedQuery && (
              <WorkspaceOverview
                referenceBuildingCount={referenceBuildingCount}
                recentUpload={recentUpload}
                modelHealth={modelHealth}
                onUploadData={onUploadData}
                onOpenAnalysis={onOpenAnalysis}
                onOpenJobs={onOpenJobs}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function WorkspaceOverview({
  referenceBuildingCount,
  recentUpload,
  modelHealth,
  onUploadData,
  onOpenAnalysis,
  onOpenJobs,
}: {
  referenceBuildingCount: number;
  recentUpload?: UploadSuccessDetails | null;
  modelHealth: { available: boolean; model: string | null } | null;
  onUploadData?: () => void;
  onOpenAnalysis?: () => void;
  onOpenJobs?: () => void;
}) {
  const detectionCount = recentUpload
    ? recentUpload.parcelCount + (recentUpload.imageAnnotationCount ?? 0)
    : 0;

  return (
    <section className="overflow-hidden rounded-2xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/10 via-slate-900/85 to-cyan-500/5 shadow-xl shadow-black/15">
      <div className="border-b border-slate-700/60 px-4 py-3.5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-cyan-300">Workspace overview</p>
            <p className="mt-1 text-sm font-bold text-white">Ready for the next survey upload</p>
          </div>
          <div className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${modelHealth?.available ? 'border-emerald-400/25 bg-emerald-400/10 text-emerald-300' : modelHealth === null ? 'border-slate-600 bg-slate-800 text-slate-400' : 'border-amber-400/25 bg-amber-400/10 text-amber-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${modelHealth?.available ? 'bg-emerald-400' : modelHealth === null ? 'animate-pulse bg-slate-400' : 'bg-amber-400'}`} />
            {modelHealth?.available ? 'AI online' : modelHealth === null ? 'Checking AI' : 'AI offline'}
          </div>
        </div>
        {modelHealth?.model && <p className="mt-2 truncate font-mono text-[9px] text-slate-500" title={modelHealth.model}>{modelHealth.model}</p>}
      </div>

      <div className="grid grid-cols-3 gap-2 p-3">
        <OverviewMetric icon={<Building2 className="h-3.5 w-3.5" />} value={referenceBuildingCount.toLocaleString()} label="OSM references" tone="cyan" />
        <OverviewMetric icon={<FileImage className="h-3.5 w-3.5" />} value={String(detectionCount)} label="Image detections" tone="indigo" />
        <OverviewMetric icon={<Cpu className="h-3.5 w-3.5" />} value={modelHealth?.available ? 'Ready' : 'Check'} label="AI service" tone="emerald" />
      </div>

      <div className="mx-3 rounded-xl border border-slate-700/65 bg-slate-950/45 p-3">
        <p className="text-[9px] font-bold uppercase tracking-[0.15em] text-slate-500">Latest upload</p>
        {recentUpload ? (
          <>
            <p className="mt-1.5 truncate text-xs font-semibold text-slate-200" title={recentUpload.filename}>{recentUpload.filename}</p>
            <p className="mt-1 text-[10px] text-slate-500">{detectionCount} boundar{detectionCount === 1 ? 'y' : 'ies'} · {recentUpload.processingMode === 'model' ? 'AI processed' : 'Manual review'}</p>
            {recentUpload.fileKind === 'imagery' && onOpenAnalysis && (
              <button type="button" onClick={onOpenAnalysis} className="mt-2 flex items-center gap-1 text-[10px] font-bold text-cyan-300 hover:text-cyan-200">Open analysis <ArrowRight className="h-3 w-3" /></button>
            )}
          </>
        ) : (
          <p className="mt-1.5 text-[11px] leading-relaxed text-slate-500">No image has been uploaded in this browser session.</p>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 p-3">
        <QuickAction icon={<UploadCloud className="h-3.5 w-3.5" />} label="Upload" onClick={onUploadData} primary />
        <QuickAction icon={<FileImage className="h-3.5 w-3.5" />} label="Analysis" onClick={onOpenAnalysis} disabled={!recentUpload || recentUpload.fileKind !== 'imagery'} />
        <QuickAction icon={<ListChecks className="h-3.5 w-3.5" />} label="Jobs" onClick={onOpenJobs} />
      </div>

      <p className="border-t border-slate-700/60 px-4 py-3 text-[10px] leading-relaxed text-slate-500">
        Cyan map shapes are OpenStreetMap building references. They provide visual context and are not legal cadastral parcels.
      </p>
    </section>
  );
}

function OverviewMetric({ icon, value, label, tone }: { icon: React.ReactNode; value: string; label: string; tone: 'cyan' | 'indigo' | 'emerald' }) {
  const tones = {
    cyan: 'border-cyan-400/20 bg-cyan-400/5 text-cyan-300',
    indigo: 'border-indigo-400/20 bg-indigo-400/5 text-indigo-300',
    emerald: 'border-emerald-400/20 bg-emerald-400/5 text-emerald-300',
  };
  return <div className={`min-w-0 rounded-xl border p-2.5 ${tones[tone]}`}><div className="flex items-center gap-1.5">{icon}<span className="truncate text-sm font-extrabold">{value}</span></div><p className="mt-1 text-[8px] font-bold uppercase leading-tight tracking-wider text-slate-500">{label}</p></div>;
}

function QuickAction({ icon, label, onClick, primary = false, disabled = false }: { icon: React.ReactNode; label: string; onClick?: () => void; primary?: boolean; disabled?: boolean }) {
  return <button type="button" onClick={onClick} disabled={disabled || !onClick} className={`flex min-w-0 items-center justify-center gap-1.5 rounded-xl border px-2 py-2.5 text-[10px] font-bold transition disabled:cursor-not-allowed disabled:opacity-35 ${primary ? 'border-indigo-400/35 bg-indigo-500/20 text-indigo-100 hover:bg-indigo-500/30' : 'border-slate-700 bg-slate-900/70 text-slate-300 hover:border-cyan-400/30 hover:text-cyan-200'}`}>{icon}<span className="truncate">{label}</span></button>;
}

interface ParcelCardProps {
  parcel: ParcelFeature;
  isEditing: boolean;
  onFlyTo?: (parcel: ParcelFeature | null) => void;
  onDecision: (parcelId: string, newStatus: 'confirmed' | 'rejected') => Promise<void>;
  onEditSave?: (parcelId: string) => Promise<void>;
  onEditSaveSuccess: (parcelId: string) => void;
}

function ParcelCard({
  parcel, isEditing,
  onFlyTo, onDecision, onEditSave, onEditSaveSuccess,
}: ParcelCardProps) {
  const { id, confidence_score, status } = parcel.properties;
  const [actionPending, setActionPending] = useState<string | null>(null);
  const [saveError, setSaveError]         = useState('');

  const isConflict  = status === 'conflict';
  const badgeColors = isConflict
    ? 'text-[#F43F5E] bg-[#F43F5E]/10 border-[#F43F5E]/30'
    : 'text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/30';

  const handleApproveReject = async (newStatus: 'confirmed' | 'rejected') => {
    if (actionPending) return;
    setSaveError('');
    setActionPending(newStatus);
    try {
      await onDecision(id, newStatus);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Parcel update failed');
      setActionPending(null);
    }
  };

  const handleEditSave = async () => {
    if (!onEditSave || actionPending) return;
    setSaveError('');
    setActionPending('saving');
    try {
      await onEditSave(id);
      onEditSaveSuccess(id);
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
      setActionPending(null);
    }
  };

  return (
    <div
      className={`bhoomix-parcel-card relative overflow-hidden rounded-2xl border bg-gradient-to-br from-slate-800/90 to-slate-900/95 p-3.5 shadow-lg transition-all duration-200 before:absolute before:inset-y-0 before:left-0 before:w-0.5 ${
        isEditing
          ? 'border-amber-400/55 shadow-amber-950/30 before:bg-amber-400'
          : isConflict
            ? 'border-rose-500/30 shadow-black/20 before:bg-rose-400 hover:border-rose-400/50'
            : 'border-slate-700/70 shadow-black/20 before:bg-amber-400 hover:-translate-y-0.5 hover:border-indigo-400/40'
      }`}
    >
      <div className="mb-2.5 flex items-center justify-between">
        <span className="max-w-[175px] truncate font-mono text-[13px] font-semibold text-slate-100">{id}</span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeColors} uppercase tracking-wider`}>
          {isConflict ? 'Conflict' : 'AI'}
        </span>
      </div>

      {isConflict && (
        <div className="flex items-center gap-1.5 px-2 py-1.5 mb-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20">
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span className="text-[11px] font-semibold text-rose-300">Spatial Overlap Detected</span>
        </div>
      )}

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-slate-500">Confidence</span>
          <span className="text-xs font-mono text-slate-300">
            {confidence_score != null ? (confidence_score * 100).toFixed(1) + '%' : 'N/A'}
          </span>
        </div>
        {confidence_score != null && (
          <div className="w-full h-1 bg-[#0B0F1A] rounded-full overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-amber-500 to-indigo-500 transition-all"
              style={{ width: `${confidence_score * 100}%` }}
            />
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          onClick={() => onFlyTo?.(parcel)}
          title="Fly to parcel on map"
          className="flex items-center gap-1 rounded-lg border border-slate-600/60 bg-slate-700/70 px-2.5 py-1.5 text-xs font-semibold text-slate-200 transition hover:border-indigo-400/50 hover:bg-indigo-500/25 hover:text-white"
        >
          <Crosshair className="w-3 h-3" />
          Fly To
        </button>

        {isEditing && onEditSave && (
          <button
            onClick={handleEditSave}
            disabled={actionPending === 'saving'}
            title="Save edited boundary to database"
            className="flex items-center gap-1 px-2 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs rounded-lg transition-colors font-medium disabled:opacity-50"
          >
            {actionPending === 'saving'
              ? <Loader2 className="w-3 h-3 animate-spin" />
              : <PenLine className="w-3 h-3" />
            }
            {actionPending === 'saving' ? 'Saving…' : 'Edit & Save'}
          </button>
        )}

        <div className="flex-1" />

        <button
          onClick={() => handleApproveReject('rejected')}
          disabled={!!actionPending}
          title="Reject parcel"
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-rose-400 transition-colors disabled:opacity-50"
        >
          {actionPending === 'rejected'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <X className="w-3.5 h-3.5" />
          }
        </button>

        <button
          onClick={() => handleApproveReject('confirmed')}
          disabled={!!actionPending}
          title="Approve parcel"
          className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/30 hover:bg-emerald-500/20 text-emerald-400 transition-colors disabled:opacity-50"
        >
          {actionPending === 'confirmed'
            ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
            : <Check className="w-3.5 h-3.5" />
          }
        </button>
      </div>

      {saveError && (
        <p className="mt-2 text-[10px] text-rose-400 font-mono">{saveError}</p>
      )}
    </div>
  );
}
