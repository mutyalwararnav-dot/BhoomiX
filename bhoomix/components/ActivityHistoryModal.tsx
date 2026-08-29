'use client';

import {
  CheckCircle2,
  Clock3,
  Edit3,
  History,
  Loader2,
  RefreshCw,
  UserRound,
  X,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

type ActivityAction = 'edited' | 'rejected' | 'confirmed';
type ActivityFilter = 'all' | ActivityAction;

interface ActivityItem {
  id: string;
  parcel_id: string;
  action: ActivityAction;
  surveyor_id: string | null;
  area_delta_sqm: number | null;
  created_at: string;
}

interface ActivityResponse {
  activities?: ActivityItem[];
  summary?: Record<ActivityAction, number>;
  total?: number;
  error?: string;
}

interface ActivityHistoryModalProps {
  onClose: () => void;
}

const actionDetails = {
  confirmed: {
    label: 'Approved',
    icon: CheckCircle2,
    colors: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300',
  },
  edited: {
    label: 'Boundary edited',
    icon: Edit3,
    colors: 'border-indigo-500/25 bg-indigo-500/10 text-indigo-300',
  },
  rejected: {
    label: 'Rejected',
    icon: XCircle,
    colors: 'border-rose-500/25 bg-rose-500/10 text-rose-300',
  },
} as const;

function formatActivityTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown time';
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatAreaDelta(value: number | null) {
  if (value == null || Math.abs(value) < 0.01) return null;
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(2)} m²`;
}

export default function ActivityHistoryModal({ onClose }: ActivityHistoryModalProps) {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [summary, setSummary] = useState<Record<ActivityAction, number>>({
    confirmed: 0,
    edited: 0,
    rejected: 0,
  });
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadActivity = useCallback(async (showSpinner: boolean) => {
    if (showSpinner) setLoading(true);
    setError('');

    try {
      const response = await fetch('/api/activity', { cache: 'no-store' });
      const payload = await response.json() as ActivityResponse;
      if (!response.ok) throw new Error(payload.error ?? `Request failed with status ${response.status}`);

      setActivities(payload.activities ?? []);
      setSummary(payload.summary ?? { confirmed: 0, edited: 0, rejected: 0 });
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Activity history could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;

    void fetch('/api/activity', { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json() as ActivityResponse;
        if (!response.ok) throw new Error(payload.error ?? `Request failed with status ${response.status}`);
        if (!active) return;
        setActivities(payload.activities ?? []);
        setSummary(payload.summary ?? { confirmed: 0, edited: 0, rejected: 0 });
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        setError(loadError instanceof Error ? loadError.message : 'Activity history could not be loaded.');
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

  const filteredActivities = useMemo(
    () => filter === 'all' ? activities : activities.filter((item) => item.action === filter),
    [activities, filter],
  );

  const filters: Array<{ id: ActivityFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: activities.length },
    { id: 'confirmed', label: 'Approved', count: summary.confirmed },
    { id: 'edited', label: 'Edited', count: summary.edited },
    { id: 'rejected', label: 'Rejected', count: summary.rejected },
  ];

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
        aria-labelledby="activity-history-title"
        className="flex max-h-[88vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#111827] shadow-2xl"
      >
        <header className="flex items-start justify-between border-b border-slate-800 bg-[#0B0F1A] px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-500/25 bg-indigo-500/10 text-indigo-300">
              <History className="h-5 w-5" />
            </div>
            <div>
              <h2 id="activity-history-title" className="text-lg font-bold text-white">Activity History</h2>
              <p className="mt-0.5 text-xs text-slate-400">Latest 100 human review actions from the parcel audit dataset.</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => void loadActivity(true)}
              disabled={loading}
              title="Refresh activity"
              aria-label="Refresh activity"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              title="Close activity history"
              aria-label="Close activity history"
              className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-800 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-slate-800 px-5 py-3">
          {filters.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ${
                filter === item.id
                  ? 'border-indigo-400/40 bg-indigo-500/15 text-indigo-200'
                  : 'border-slate-700 bg-slate-900/60 text-slate-400 hover:text-slate-200'
              }`}
            >
              {item.label} <span className="ml-1 font-mono text-[10px] opacity-70">{item.count}</span>
            </button>
          ))}
        </div>

        <div className="min-h-64 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <div className="flex h-56 flex-col items-center justify-center gap-3 text-slate-400">
              <Loader2 className="h-7 w-7 animate-spin text-indigo-400" />
              <p className="text-sm">Loading activity history...</p>
            </div>
          ) : error ? (
            <div className="flex h-56 flex-col items-center justify-center text-center">
              <XCircle className="mb-3 h-8 w-8 text-rose-400" />
              <p className="text-sm font-semibold text-rose-300">Could not load activity</p>
              <p className="mt-1 max-w-md text-xs text-slate-500">{error}</p>
              <button
                type="button"
                onClick={() => void loadActivity(true)}
                className="mt-4 rounded-lg bg-slate-800 px-3 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                Try again
              </button>
            </div>
          ) : filteredActivities.length === 0 ? (
            <div className="flex h-56 flex-col items-center justify-center text-center">
              <Clock3 className="mb-3 h-8 w-8 text-slate-600" />
              <p className="text-sm font-semibold text-slate-300">No activity found</p>
              <p className="mt-1 text-xs text-slate-500">Review actions will appear here automatically.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filteredActivities.map((item) => {
                const details = actionDetails[item.action];
                const ActionIcon = details.icon;
                const areaDelta = formatAreaDelta(item.area_delta_sqm);

                return (
                  <article key={item.id} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5">
                    <div className="flex items-start gap-3">
                      <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${details.colors}`}>
                        <ActionIcon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="text-xs font-bold text-slate-200">{details.label}</span>
                            <span className="truncate font-mono text-xs text-indigo-300">{item.parcel_id}</span>
                          </div>
                          <time className="shrink-0 text-[10px] text-slate-500">{formatActivityTime(item.created_at)}</time>
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-500">
                          <span className="flex items-center gap-1.5">
                            <UserRound className="h-3 w-3" />
                            {item.surveyor_id || 'Guest'}
                          </span>
                          {areaDelta && (
                            <span className={item.area_delta_sqm != null && item.area_delta_sqm > 0 ? 'text-amber-300' : 'text-sky-300'}>
                              Area change: {areaDelta}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
