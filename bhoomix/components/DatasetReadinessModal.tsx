'use client';

import {
  AlertTriangle,
  BrainCircuit,
  CheckCircle2,
  Download,
  FileCheck2,
  Images,
  Loader2,
  RefreshCw,
  ShieldCheck,
  UsersRound,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import { useAuth } from '@/components/auth/AuthProvider';

type ReadinessLevel = 'collecting' | 'pilot_ready' | 'training_ready';

interface ReadinessData {
  readiness: ReadinessLevel;
  quality_score: number;
  total_samples: number;
  usable_samples: number;
  geometry_usable_samples: number;
  image_linked_samples: number;
  image_annotation_samples: number;
  annotated_images: number;
  excluded_demo_annotations: number;
  pending_image_annotations: number;
  rejected_image_annotations: number;
  annotations_missing_dimensions: number;
  invalid_samples: number;
  unique_parcels: number;
  duplicate_records: number;
  correction_pairs: number;
  identified_samples: number;
  guest_samples: number;
  actions: {
    confirmed: number;
    edited: number;
    rejected: number;
  };
  issues: string[];
  generated_at: string;
}

interface DatasetReadinessModalProps {
  onClose: () => void;
}

const readinessLabels: Record<ReadinessLevel, { title: string; description: string; colors: string }> = {
  collecting: {
    title: 'Collecting data',
    description: 'Continue human review before starting model training.',
    colors: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  },
  pilot_ready: {
    title: 'Pilot training ready',
    description: 'Suitable for an experimental training run, but continue collecting data.',
    colors: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
  },
  training_ready: {
    title: 'Full training ready',
    description: 'The dataset meets the current volume and geometry-quality targets.',
    colors: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  },
};

export default function DatasetReadinessModal({ onClose }: DatasetReadinessModalProps) {
  const { profile } = useAuth();
  const [data, setData] = useState<ReadinessData | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<'map' | 'images' | null>(null);
  const [error, setError] = useState('');

  const loadReadiness = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/dataset/readiness', { cache: 'no-store' });
      const payload = await response.json() as ReadinessData & { error?: string };
      if (!response.ok) throw new Error(payload.error ?? `Request failed with status ${response.status}`);
      setData(payload);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Dataset readiness could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch('/api/dataset/readiness', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as ReadinessData & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `Request failed with status ${response.status}`);
        if (active) setData(payload);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Dataset readiness could not be loaded.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const downloadDataset = async (kind: 'map' | 'images') => {
    if (downloading) return;
    setDownloading(kind);
    setError('');
    try {
      const response = await apiFetch(kind === 'map' ? '/api/feedback/export' : '/api/dataset/image-annotations');
      const contentType = response.headers.get('content-type') ?? '';
      if (!response.ok) {
        const payload = contentType.includes('json') ? await response.json() as { error?: string } : null;
        throw new Error(payload?.error ?? `Export failed with status ${response.status}`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = kind === 'map' ? 'bhoomix_retraining_dataset.geojson' : 'bhoomix_image_annotations.json';
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (downloadError: unknown) {
      setError(downloadError instanceof Error ? downloadError.message : 'Dataset export failed.');
    } finally {
      setDownloading(null);
    }
  };

  const status = data ? readinessLabels[data.readiness] : null;
  const canExport = Boolean(profile && ['admin', 'surveyor'].includes(profile.role));

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="dataset-readiness-title"
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#111827] shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-slate-800 bg-[#0B0F1A] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-500/25 bg-violet-500/10 text-violet-300">
              <BrainCircuit className="h-5 w-5" />
            </div>
            <div>
              <h2 id="dataset-readiness-title" className="text-lg font-bold text-white">Training Dataset Readiness</h2>
              <p className="mt-0.5 text-xs text-slate-400">Quality and balance checks for reviewed map parcels and image polygons.</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void loadReadiness()}
              disabled={loading}
              aria-label="Refresh dataset readiness"
              title="Refresh dataset readiness"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close dataset readiness"
              title="Close dataset readiness"
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex h-72 flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="h-8 w-8 animate-spin text-violet-400" />
              <p className="text-sm">Analyzing feedback dataset...</p>
            </div>
          ) : error && !data ? (
            <div className="flex h-72 flex-col items-center justify-center text-center">
              <AlertTriangle className="mb-3 h-9 w-9 text-rose-400" />
              <p className="text-sm font-semibold text-rose-300">Analysis unavailable</p>
              <p className="mt-1 max-w-md text-xs text-slate-500">{error}</p>
              <button type="button" onClick={() => void loadReadiness()} className="mt-4 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-white hover:bg-slate-700">Try again</button>
            </div>
          ) : data && status ? (
            <div className="space-y-5">
              <div className={`rounded-xl border p-4 ${status.colors}`}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-base font-bold">{status.title}</p>
                    <p className="mt-1 text-xs opacity-80">{status.description}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-3xl font-bold">{data.quality_score}%</p>
                    <p className="text-[10px] font-semibold uppercase tracking-wider opacity-70">training usability</p>
                  </div>
                </div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-black/20">
                  <div className="h-full rounded-full bg-current transition-all" style={{ width: `${data.quality_score}%` }} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {[
                  { label: 'Model-ready samples', value: data.usable_samples, icon: FileCheck2, color: 'text-emerald-300' },
                  { label: 'Image polygons', value: data.image_annotation_samples, icon: Images, color: 'text-sky-300' },
                  { label: 'Correction pairs', value: data.correction_pairs, icon: ShieldCheck, color: 'text-indigo-300' },
                  { label: 'Identified reviews', value: data.identified_samples, icon: UsersRound, color: 'text-violet-300' },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                    <metric.icon className={`mb-3 h-4 w-4 ${metric.color}`} />
                    <p className="font-mono text-xl font-bold text-white">{metric.value}</p>
                    <p className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{metric.label}</p>
                  </div>
                ))}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Class distribution</h3>
                  <div className="mt-4 space-y-3 text-xs">
                    {[
                      { label: 'Approved', value: data.actions.confirmed, color: 'bg-emerald-500' },
                      { label: 'Edited', value: data.actions.edited, color: 'bg-indigo-500' },
                      { label: 'Rejected', value: data.actions.rejected, color: 'bg-rose-500' },
                    ].map((item) => (
                      <div key={item.label}>
                        <div className="mb-1 flex items-center justify-between text-slate-400"><span>{item.label}</span><span className="font-mono text-slate-200">{item.value}</span></div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${item.color}`} style={{ width: `${data.total_samples ? Math.max(2, (item.value / data.total_samples) * 100) : 0}%` }} /></div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300">Before full training</h3>
                  {data.issues.length ? (
                    <ul className="mt-3 space-y-2">
                      {data.issues.map((issue) => (
                        <li key={issue} className="flex items-start gap-2 text-xs leading-5 text-slate-400">
                          <AlertTriangle className="mt-1 h-3 w-3 shrink-0 text-amber-400" />
                          {issue}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="mt-4 flex items-center gap-2 text-xs text-emerald-300"><CheckCircle2 className="h-4 w-4" />No blocking dataset issues detected.</div>
                  )}
                </div>
              </div>

              {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
            </div>
          ) : null}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-[#0B0F1A] px-5 py-4">
          <p className="text-[10px] text-slate-500">Exports data only; model training is not started.</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void downloadDataset('map')}
              disabled={!data || Boolean(downloading) || !canExport}
              title={canExport ? 'Download reviewed map parcels' : 'Sign in as a surveyor or administrator to export training data'}
              className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-slate-700 disabled:opacity-50"
            >
              {downloading === 'map' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading === 'map' ? 'Preparing...' : 'Map GeoJSON'}
            </button>
            <button
              type="button"
              onClick={() => void downloadDataset('images')}
              disabled={!data || Boolean(downloading) || !canExport}
              title={canExport ? 'Download reviewed image polygons' : 'Sign in as a surveyor or administrator to export training data'}
              className="flex items-center gap-2 rounded-lg bg-violet-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-violet-500 disabled:opacity-50"
            >
              {downloading === 'images' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
              {downloading === 'images' ? 'Preparing...' : canExport ? 'Image annotations' : 'Surveyor access required'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
