'use client';

import { useMemo, useState } from 'react';
import { CheckCircle2, Layers3, Loader2, Mountain, X } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { uploadImageryDirect } from '@/lib/direct-imagery-upload';

type LayerName = 'ori' | 'dsm' | 'dtm';

export interface ElevationLayerResult {
  previewUrl: string;
  boundingBox: [number, number, number, number];
  crs: string;
  width: number;
  height: number;
  statistics: {
    minimum_m: number;
    maximum_m: number;
    mean_m: number;
    p98_m: number;
    valid_coverage: number;
  };
}

interface ProcessingPayload {
  validation?: {
    target_crs?: string;
    aligned_width?: number;
    aligned_height?: number;
    wgs84_bounds?: number[];
  };
  ndsm_statistics?: ElevationLayerResult['statistics'];
  previewUrl?: string;
  error?: string;
}

const labels: Record<LayerName, { title: string; detail: string }> = {
  ori: { title: 'ORI', detail: 'Orthorectified RGB GeoTIFF' },
  dsm: { title: 'DSM', detail: 'Surface elevation GeoTIFF' },
  dtm: { title: 'DTM', detail: 'Ground elevation GeoTIFF' },
};

export default function ElevationUploadModal({
  isOpen,
  onClose,
  onComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  onComplete: (result: ElevationLayerResult) => void;
}) {
  const [files, setFiles] = useState<Partial<Record<LayerName, File>>>({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ElevationLayerResult | null>(null);
  const [progress, setProgress] = useState<Record<LayerName, number>>({ ori: 0, dsm: 0, dtm: 0 });
  const ready = useMemo(() => Boolean(files.ori && files.dsm && files.dtm), [files]);

  if (!isOpen) return null;

  const chooseFile = (layer: LayerName, file: File | undefined) => {
    setError(null);
    setResult(null);
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();
    if (!['tif', 'tiff'].includes(extension ?? '')) {
      setError(`${labels[layer].title} must be a TIFF or GeoTIFF file.`);
      return;
    }
    setFiles(current => ({ ...current, [layer]: file }));
  };

  const processBundle = async () => {
    if (!files.ori || !files.dsm || !files.dtm) return;
    setProcessing(true);
    setError(null);
    const stagedPaths: string[] = [];
    try {
      setProgress({ ori: 0, dsm: 0, dtm: 0 });
      const entries: Array<readonly [LayerName, Awaited<ReturnType<typeof uploadImageryDirect>>]> = [];
      for (const layer of ['ori', 'dsm', 'dtm'] as const) {
        const staged = await uploadImageryDirect(files[layer]!, percentage => {
          setProgress(current => ({ ...current, [layer]: percentage }));
        }, { purpose: 'elevation', layerType: layer });
        stagedPaths.push(staged.storagePath);
        entries.push([layer, staged] as const);
      }
      const response = await apiFetch('/api/elevation/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layers: Object.fromEntries(entries) }),
      });
      const payload = await response.json() as ProcessingPayload;
      if (!response.ok) throw new Error(payload.error || 'Elevation processing failed.');
      const bbox = payload.validation?.wgs84_bounds;
      const stats = payload.ndsm_statistics;
      if (!payload.previewUrl || !stats || !bbox || bbox.length !== 4) {
        throw new Error('The raster service returned an incomplete result.');
      }
      const completed: ElevationLayerResult = {
        previewUrl: payload.previewUrl,
        boundingBox: bbox as [number, number, number, number],
        crs: payload.validation?.target_crs || 'Unknown CRS',
        width: payload.validation?.aligned_width || 0,
        height: payload.validation?.aligned_height || 0,
        statistics: stats,
      };
      setResult(completed);
      onComplete(completed);
    } catch (processingError: unknown) {
      if (stagedPaths.length) {
        void apiFetch('/api/imagery/staged', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: stagedPaths }),
        });
      }
      setError(processingError instanceof Error ? processingError.message : 'Elevation processing failed.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-label="ORI DSM DTM processing" className="w-full max-w-3xl rounded-2xl border border-cyan-400/25 bg-slate-950 p-6 shadow-2xl" onClick={event => event.stopPropagation()}>
        <header className="mb-5 flex items-start justify-between gap-4">
          <div className="flex gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-cyan-400/10 text-cyan-300"><Layers3 className="h-5 w-5" /></div>
            <div><h2 className="text-lg font-bold text-white">ORI + DSM + DTM</h2><p className="text-xs text-slate-400">Validate, align and calculate the normalized height layer (nDSM).</p></div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.keys(labels) as LayerName[]).map(layer => (
            <label key={layer} className="cursor-pointer rounded-xl border border-slate-700 bg-slate-900/70 p-4 hover:border-cyan-400/50">
              <span className="block text-sm font-bold text-cyan-200">{labels[layer].title}</span>
              <span className="mt-1 block text-[11px] text-slate-500">{labels[layer].detail}</span>
              <span className="mt-3 block truncate text-xs text-slate-300">{files[layer]?.name || 'Choose GeoTIFF'}</span>
              {processing && <span className="mt-2 block text-[10px] font-semibold text-cyan-300">{progress[layer]}% uploaded</span>}
              <input type="file" accept=".tif,.tiff,image/tiff" className="hidden" onChange={event => chooseFile(layer, event.target.files?.[0])} />
            </label>
          ))}
        </div>

        {error && <p className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">{error}</p>}

        {result && (
          <div className="mt-4 grid gap-4 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4 sm:grid-cols-[180px_1fr]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={result.previewUrl} alt="Generated nDSM height preview" className="h-40 w-full rounded-lg object-cover" />
            <div>
              <p className="flex items-center gap-2 text-sm font-bold text-emerald-300"><CheckCircle2 className="h-4 w-4" /> Layers aligned successfully</p>
              <p className="mt-2 text-xs text-slate-400">{result.crs} · {result.width} × {result.height} aligned pixels</p>
              <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-300">
                <span>Mean height: {result.statistics.mean_m.toFixed(1)} m</span>
                <span>Maximum: {result.statistics.maximum_m.toFixed(1)} m</span>
                <span>Coverage: {(result.statistics.valid_coverage * 100).toFixed(1)}%</span>
                <span>98th percentile: {result.statistics.p98_m.toFixed(1)} m</span>
              </div>
            </div>
          </div>
        )}

        <footer className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">GeoTIFF only · up to 100 MB per layer · all layers must cover the same area.</p>
          <button type="button" disabled={!ready || processing} onClick={() => void processBundle()} className="flex shrink-0 items-center gap-2 rounded-xl bg-cyan-600 px-4 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40">
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mountain className="h-4 w-4" />}
            {processing ? 'Aligning layers…' : 'Generate nDSM'}
          </button>
        </footer>
      </section>
    </div>
  );
}
