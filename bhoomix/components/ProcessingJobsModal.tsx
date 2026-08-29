'use client';

import { AlertTriangle, CheckCircle2, Clock3, Cpu, Loader2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';

type JobStatus = 'queued' | 'processing' | 'completed' | 'failed';

interface ProcessingJob {
  id: string;
  status: JobStatus;
  processing_mode: 'demo' | 'model';
  progress: number;
  parcel_count: number;
  conflict_count: number;
  model_version: string | null;
  error_message: string | null;
  requested_by: string;
  created_at: string;
  upload: {
    filename: string;
    file_size_bytes: number | null;
    mime_type: string | null;
    uploaded_by: string;
  } | null;
}

const statusStyles: Record<JobStatus, string> = {
  queued: 'border-slate-600 bg-slate-700/40 text-slate-300',
  processing: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  completed: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
  failed: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

function formatBytes(bytes: number | null) {
  if (bytes === null) return 'Unknown size';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function ProcessingJobsModal({ onClose }: { onClose: () => void }) {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadJobs = useCallback(async () => {
    setError('');
    try {
      const response = await apiFetch('/api/processing-jobs', { cache: 'no-store' });
      const payload = await response.json() as { jobs?: ProcessingJob[]; error?: string };
      if (!response.ok) throw new Error(payload.error || `Request failed with status ${response.status}`);
      setJobs(payload.jobs ?? []);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Job history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadJobs(), 0);
    const interval = window.setInterval(() => void loadJobs(), 4000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadJobs]);

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section role="dialog" aria-modal="true" aria-labelledby="processing-jobs-title" className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#111827] shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-800 bg-[#0B0F1A] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-500/25 bg-indigo-500/10 text-indigo-300"><Cpu className="h-5 w-5" /></div>
            <div><h2 id="processing-jobs-title" className="text-lg font-bold text-white">Imagery Processing Jobs</h2><p className="text-xs text-slate-400">Recent AI extraction runs and their results</p></div>
          </div>
          <div className="flex gap-1"><button type="button" onClick={() => void loadJobs()} title="Refresh jobs" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><RefreshCw className="h-4 w-4" /></button><button type="button" onClick={onClose} title="Close" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button></div>
        </header>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? <div className="flex h-56 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-indigo-400" /></div> : error ? <div className="flex h-56 flex-col items-center justify-center text-center"><AlertTriangle className="mb-3 h-8 w-8 text-rose-400" /><p className="text-sm text-rose-300">{error}</p></div> : jobs.length === 0 ? <div className="flex h-56 flex-col items-center justify-center text-center text-slate-500"><Clock3 className="mb-3 h-8 w-8" /><p className="text-sm">No imagery-processing jobs yet.</p></div> : <div className="space-y-3">
            {jobs.map((job) => <article key={job.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-white">{job.upload?.filename || `Upload ${job.id.slice(0, 8)}`}</p><p className="mt-1 text-[11px] text-slate-500">{formatBytes(job.upload?.file_size_bytes ?? null)} · {new Date(job.created_at).toLocaleString()} · {job.requested_by}</p></div><span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${statusStyles[job.status]}`}>{job.status}</span></div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-800"><div className={`h-full rounded-full ${job.status === 'failed' ? 'bg-rose-500' : job.status === 'completed' ? 'bg-emerald-500' : 'bg-indigo-500'}`} style={{ width: `${job.progress}%` }} /></div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-slate-400"><span>{job.processing_mode === 'model' ? 'Real model' : 'Demo mode'}</span><span>{job.parcel_count} parcels</span><span>{job.conflict_count} conflicts</span>{job.model_version && <span>{job.model_version}</span>}</div>
              {job.error_message && <p className="mt-2 rounded-lg bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">{job.error_message}</p>}
              {job.status === 'completed' && <div className="mt-2 flex items-center gap-1.5 text-[11px] text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />Processing completed successfully</div>}
            </article>)}
          </div>}
        </div>
      </section>
    </div>
  );
}
