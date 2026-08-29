'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Brain, Download, Loader2, CheckCircle2 } from 'lucide-react';
import { useAuth } from '@/components/auth/AuthProvider';
import { apiFetch } from '@/lib/api-fetch';

// ─── FeedbackSyncButton ─────────────────────────────────────────────────────────
// Live badge showing count of human-verified correction samples.
// "Sync Feedback" button downloads the ML training dataset as GeoJSON.
// ───────────────────────────────────────────────────────────────────────────────
export default function FeedbackSyncButton() {
  const { profile } = useAuth();
  const [sampleCount, setSampleCount]   = useState<number | null>(null);
  const [isSyncing, setIsSyncing]       = useState(false);
  const [justSynced, setJustSynced]     = useState(false);

  // ── Fetch count from parcels table directly for ground truth ──────────────
  const fetchCount = useCallback(async () => {
    try {
      // We want to count how many parcels are 'reviewed_edited' or 'confirmed'
      const { count, error } = await supabase
        .from('parcels')
        .select('*', { count: 'exact', head: true })
        .in('status', ['reviewed_edited', 'confirmed']);

      if (!error) setSampleCount(count ?? 0);
    } catch {
      setSampleCount(null);
    }
  }, []);

 useEffect(() => {
    let isMounted = true;

    const safeFetch = async () => {
      if (isMounted) {
        await fetchCount();
      }
    };

    safeFetch();
    
    // Refresh the count every 30 seconds
    const interval = setInterval(safeFetch, 30_000);
    
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [fetchCount]);

  // ── Download ML dataset GeoJSON ───────────────────────────────────────────
  const handleSync = useCallback(async () => {
    if (isSyncing) return;
    setIsSyncing(true);
    setJustSynced(false);

    try {
      const res = await apiFetch('/api/feedback/export');
      if (!res.ok) throw new Error(`Export failed: ${res.status}`);

      // Even though the route returns application/geo+json, we can parse it
      // or just stream it directly into a blob.
      const blob = await res.blob();
      
      const url = URL.createObjectURL(blob);
      const tag = document.createElement('a');
      tag.href = url;
      tag.download = 'bhoomix_retraining_dataset.geojson';
      tag.click();
      URL.revokeObjectURL(url);

      setJustSynced(true);
      setTimeout(() => setJustSynced(false), 3000);
      fetchCount(); // refresh badge after export
    } catch (err) {
      console.error('[FeedbackSync] Export error:', err);
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing, fetchCount]);

  // Training exports are restricted to signed-in surveyors and administrators.
  if (sampleCount === null || !profile || !['admin', 'surveyor'].includes(profile.role)) return null;

  return (
    <button
      id="btn-feedback-sync"
      onClick={handleSync}
      disabled={isSyncing}
      title={`${sampleCount} human-verified samples ready for model fine-tuning`}
      className="flex items-center gap-2 px-3 py-1.5 rounded-lg
        bg-slate-800/80 hover:bg-slate-700 border border-slate-700
        hover:border-indigo-500/50 text-slate-300 hover:text-white
        text-xs font-semibold transition-all group
        disabled:opacity-60 disabled:cursor-not-allowed"
    >
      {/* Icon */}
      {isSyncing ? (
        <Loader2 className="w-3.5 h-3.5 text-indigo-400 animate-spin" />
      ) : justSynced ? (
        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
      ) : (
        <Brain className="w-3.5 h-3.5 text-indigo-400 group-hover:text-indigo-300" />
      )}

      {/* Label */}
      <span>
        {isSyncing ? 'Syncing...' : justSynced ? 'Downloaded!' : 'Sync Feedback'}
      </span>

      {/* Download icon */}
      {!isSyncing && !justSynced && (
        <Download className="w-3 h-3 text-slate-500 group-hover:text-slate-300" />
      )}

      {/* Badge — sample count */}
      {sampleCount > 0 && (
        <span className="flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full
          bg-indigo-600 text-white text-[10px] font-bold leading-none ml-0.5">
          {sampleCount > 99 ? '99+' : sampleCount}
        </span>
      )}
    </button>
  );
}
