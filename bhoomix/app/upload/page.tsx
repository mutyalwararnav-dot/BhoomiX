'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, Loader2, AlertCircle, FileJson, Image as ImageIcon } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { processImageryFile, processStagedImagery, uploadImageryDirect } from '@/lib/direct-imagery-upload';

type Status = 'idle' | 'uploading' | 'processing' | 'parsing' | 'inserting' | 'success' | 'error';

interface ImportedParcelProperties {
  id?: string;
  confidence_score?: number;
  computed_area_sqm?: number;
  land_use?: string;
}

function GeoJSONUploadPageContent() {
  const router = useRouter();
  const [status, setStatus]       = useState<Status>('idle');
  const [errorMsg, setErrorMsg]   = useState('');
  const [parcelCount, setParcelCount] = useState(0);
  const [processingMode, setProcessingMode] = useState<'model' | 'demo' | 'geojson' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const processGeoJSON = (file: File) => {
    setStatus('parsing');
    const reader = new FileReader();

    reader.onload = async (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content) as GeoJSON.FeatureCollection<
          GeoJSON.Geometry,
          ImportedParcelProperties
        >;

        if (!parsed || parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) {
          throw new Error('File is not a valid GeoJSON FeatureCollection.');
        }

        setStatus('inserting');
        const response = await apiFetch('/api/import-parcels', {
          method: 'POST',
          headers: { 'Content-Type': 'application/geo+json' },
          body: content,
        });
        const result = await response.json() as { parcelCount?: number; error?: string };
        if (!response.ok) throw new Error(result.error || `Import failed with status ${response.status}`);
        const insertedCount = result.parcelCount ?? 0;

        // Run spatial validation
        await apiFetch('/api/validate-parcels', { method: 'POST', body: '{}' }).catch(() => {});

        setParcelCount(insertedCount);
        setProcessingMode('geojson');
        setStatus('success');
        setTimeout(() => router.push('/'), 1500);

      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to process GeoJSON';
        setErrorMsg(message);
        setStatus('error');
      }
    };

    reader.onerror = () => {
      setErrorMsg('Failed to read the file.');
      setStatus('error');
    };
    reader.readAsText(file);
  };

  const processRawImage = async (file: File) => {
    setStatus('uploading');
    try {
      setStatus('processing');
      const data = file.size <= 8 * 1024 * 1024
        ? await processImageryFile<{ parcelCount?: number; processingMode?: 'model' | 'demo' }>(file)
        : await uploadImageryDirect(file).then((staged) => processStagedImagery<{ parcelCount?: number; processingMode?: 'model' | 'demo' }>(staged));
      setParcelCount(data.parcelCount ?? 0);
      setProcessingMode(data.processingMode === 'model' ? 'model' : 'demo');
      setStatus('success');
      setTimeout(() => router.push('/'), 1500);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Image processing failed';
      setErrorMsg(message);
      setStatus('error');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');

    const ext = file.name.split('.').pop()?.toLowerCase();

    // We now accept BOTH images AND GeoJSON
    if (ext === 'geojson' || ext === 'json') {
      processGeoJSON(file);
    } else if (['jpg', 'jpeg', 'png', 'tiff', 'tif'].includes(ext || '')) {
      processRawImage(file);
    } else {
      setErrorMsg('Invalid file type. Upload a GeoJSON file or a raw drone image (JPG/PNG/TIFF).');
      setStatus('error');
    }

    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-slate-950 p-6">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-2">Ingest Survey Data</h2>
        <p className="text-slate-400 mb-8 text-sm">
          Upload raw drone imagery (for AI pipeline extraction) or a pre-processed GeoJSON map.
        </p>

        {(status === 'idle' || status === 'error') && (
          <>
            <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-slate-700 border-dashed rounded-lg cursor-pointer bg-slate-800/50 hover:bg-slate-800 hover:border-indigo-500 transition-all">
              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                <div className="flex gap-4 mb-4">
                  <ImageIcon className="w-10 h-10 text-slate-400" />
                  <FileJson className="w-10 h-10 text-slate-400" />
                </div>
                <p className="mb-2 text-sm text-slate-300">
                  <span className="font-semibold text-indigo-400">Click to upload</span> or drag and drop
                </p>
                <p className="text-xs text-slate-500">.geojson, .json, .tiff, .jpg, .png</p>
              </div>
              <input
                ref={inputRef}
                type="file"
                className="hidden"
                accept=".geojson,.json,image/*,.tiff,.tif"
                onChange={handleFileUpload}
              />
            </label>

            {status === 'error' && (
              <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                <p className="text-xs text-rose-300 break-words">{errorMsg}</p>
              </div>
            )}
          </>
        )}

        {status === 'uploading' && (
          <div className="flex flex-col items-center justify-center h-64 bg-slate-800/30 border border-slate-700 rounded-lg">
            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
            <p className="text-slate-300 font-medium">Uploading imagery...</p>
            <p className="text-slate-500 text-xs mt-1">Sending file to Storage</p>
          </div>
        )}

        {(status === 'processing' || status === 'parsing') && (
          <div className="flex flex-col items-center justify-center h-64 bg-slate-800/30 border border-slate-700 rounded-lg">
            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
            <p className="text-slate-300 font-medium">{status === 'processing' ? 'Running AI Extraction...' : 'Reading file...'}</p>
            <p className="text-slate-500 text-xs mt-1">Please wait</p>
          </div>
        )}

        {status === 'inserting' && (
          <div className="flex flex-col items-center justify-center h-64 bg-slate-800/30 border border-slate-700 rounded-lg">
            <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4" />
            <p className="text-amber-400 font-medium">Inserting into PostGIS...</p>
            <p className="text-slate-500 text-xs mt-2">Writing polygon boundaries to database</p>
          </div>
        )}

        {status === 'success' && (
          <div className="flex flex-col items-center justify-center h-64 bg-emerald-900/20 border border-emerald-500/30 rounded-lg text-center">
            <CheckCircle className="w-12 h-12 text-emerald-500 mb-4 mx-auto" />
            <p className="text-emerald-400 font-medium text-lg">Ingestion Complete!</p>
            <p className="text-slate-400 text-sm mt-1 mb-6">
              {parcelCount} parcel{parcelCount !== 1 ? 's' : ''} added successfully. Redirecting...
            </p>
            {processingMode === 'demo' && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                Demo mode: these boundaries are simulated until the trained model service is connected.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function GeoJSONUploadPage() {
  return <GeoJSONUploadPageContent />;
}
