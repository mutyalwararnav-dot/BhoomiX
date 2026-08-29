'use client';

import { useEffect, useState } from 'react';
import { supabase, type ParcelFeature } from '@/lib/supabase';
import { Crosshair, Check, X, Loader2, PenLine, ShieldAlert, ScanSearch, Search } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';

interface TriageSidebarProps {
  onFlyTo?: (parcel: ParcelFeature | null) => void;
  onParcelStatusChange?: () => void;
  onEditSave?: (parcelId: string) => Promise<void>;
  editingParcelId?: string | null;
  refreshTrigger?: number;
  onValidationComplete?: (conflictCount: number) => void;
}

export default function TriageSidebar({
  onFlyTo,
  onParcelStatusChange,
  onEditSave,
  editingParcelId,
  refreshTrigger = 0,
  onValidationComplete,
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

  useEffect(() => {
    async function loadParcels() {
      setIsLoading(true);
      const { data, error } = await supabase.rpc('get_parcels_as_geojson');
      if (error) {
        console.error('[BhoomiX] Sidebar fetch error:', error.message);
      } else if (data) {
        const fc = data as GeoJSON.FeatureCollection<GeoJSON.Polygon>;
        const triageParcels = (fc.features as ParcelFeature[]).filter(
          (f) => f.properties.status === 'ai_suggestion' || f.properties.status === 'conflict'
        );
        setParcels(triageParcels);
      }
      setIsLoading(false);
    }
    loadParcels();
  }, [refreshTrigger]);

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

      const { data: fresh, error } = await supabase.rpc('get_parcels_as_geojson');
      if (!error && fresh) {
        const fc = fresh as GeoJSON.FeatureCollection<GeoJSON.Polygon>;
        setParcels((fc.features as ParcelFeature[]).filter(
          f => f.properties.status === 'ai_suggestion' || f.properties.status === 'conflict'
        ));
      }
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
    <div className="w-full h-full bg-[#111827] border-r border-[#2D3748] flex flex-col overflow-hidden shadow-2xl z-20">
      <div className="p-5 border-b border-[#2D3748] shrink-0 bg-[#0B0F1A]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-200 tracking-tight">Surveyor Triage</h2>
            <p className="text-xs text-slate-500 mt-1">Review AI suggestions and resolve conflicts</p>
          </div>
          <button
            onClick={handleValidate}
            disabled={isValidating}
            title="Run spatial overlap validation now"
            className="flex items-center gap-1.5 px-2.5 py-1.5 bg-[#1E2535] hover:bg-indigo-600/20 border border-[#2D3748] hover:border-indigo-500/50 text-slate-400 hover:text-indigo-300 rounded-lg text-xs font-medium transition-colors disabled:opacity-50 mt-0.5 shrink-0"
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
        <div className="mt-4 space-y-2">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search parcel ID or land use"
              className="w-full rounded-lg border border-[#2D3748] bg-[#111827] py-2 pl-9 pr-3 text-xs text-slate-200 outline-none transition focus:border-indigo-500/60 focus:ring-2 focus:ring-indigo-500/10"
            />
          </label>
          <div className="grid grid-cols-3 gap-1 rounded-lg bg-[#111827] p-1">
            {[
              { value: 'all', label: `All ${parcels.length}` },
              { value: 'conflict', label: `Conflicts ${totalConflicts}` },
              { value: 'ai_suggestion', label: `AI ${totalSuggestions}` },
            ].map((filter) => (
              <button
                key={filter.value}
                type="button"
                onClick={() => setQueueFilter(filter.value as typeof queueFilter)}
                className={`rounded-md px-2 py-1.5 text-[10px] font-semibold transition-colors ${
                  queueFilter === filter.value
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {(queueFilter === 'all' || queueFilter === 'conflict') && <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-[#F43F5E]" />
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
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
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
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
          </>
        )}
      </div>
    </div>
  );
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
      className={`bg-[#1E2535] border rounded-xl p-3 shadow-sm transition-all ${
        isEditing
          ? 'border-amber-500/60 shadow-amber-500/10 shadow-md'
          : isConflict
            ? 'border-rose-500/40 shadow-rose-500/5 shadow-sm'
            : 'border-[#2D3748] hover:border-indigo-500/30'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-mono font-semibold text-slate-200 truncate max-w-[140px]">{id}</span>
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
          className="flex items-center gap-1 px-2 py-1.5 bg-[#2D3748] hover:bg-indigo-600 hover:text-white text-slate-300 text-xs rounded-lg transition-colors font-medium"
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
