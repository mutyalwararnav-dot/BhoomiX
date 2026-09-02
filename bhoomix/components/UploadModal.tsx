'use client';

import { useState, useRef, useCallback } from 'react';
import { UploadCloud, CheckCircle, AlertCircle, Loader2, X, FileImage, Cpu, ArrowRight } from 'lucide-react';
import { apiFetch } from '@/lib/api-fetch';
import { processImageryFile, processStagedImagery, uploadImageryDirect } from '@/lib/direct-imagery-upload';
import type { ImageAnnotation } from '@/lib/image-annotations';

// ─── Types ──────────────────────────────────────────────────────────────────────
type UploadStage = 'idle' | 'validating' | 'uploading' | 'processing' | 'done' | 'error';

interface UploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess?: (result: UploadSuccessDetails) => void;
  onViewJobs?: () => void;
  onOpenAnalysis?: () => void;
}

export interface UploadSuccessDetails {
  uploadId: string | null;
  filename: string;
  fileKind: 'geojson' | 'imagery';
  parcelCount: number;
  imageAnnotationCount?: number;
  imageAnnotations?: ImageAnnotation[];
  jobId: string | null;
  processingMode: 'demo' | 'model' | null;
  isGeoreferenced: boolean;
  sourceFile: File | null;
  analysisPreviewUrl?: string | null;
}

// ─── File validation ────────────────────────────────────────────────────────────
const ACCEPTED_TYPES = ['application/geo+json', 'application/json'];
const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'tif', 'tiff'];
const MAX_BYTES       = 25 * 1024 * 1024; // Keep browser-side JSON parsing bounded
const FAST_LOCAL_UPLOAD_BYTES = 8 * 1024 * 1024;
const ANALYSIS_PREVIEW_EDGE = 1800;

async function createAnalysisPreviewUrl(file: File) {
  if (!['image/jpeg', 'image/png'].includes(file.type) || typeof createImageBitmap !== 'function') return null;
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, ANALYSIS_PREVIEW_EDGE / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, width, height);
    const preview = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return preview ? URL.createObjectURL(preview) : null;
  } finally {
    bitmap.close();
  }
}

function validateFile(file: File): string | null {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const validGeoJson = ['geojson', 'json'].includes(ext ?? '') || ACCEPTED_TYPES.includes(file.type);
  const validImage = IMAGE_EXTENSIONS.includes(ext ?? '') || ['image/jpeg', 'image/png', 'image/tiff'].includes(file.type);

  if (!validGeoJson && !validImage) {
    return `Unsupported file type "${file.type || ext}". Upload GeoJSON, JPG, PNG, or TIFF.`;
  }
  if (file.size > MAX_BYTES) {
    return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Maximum is 25 MB.`;
  }
  return null; 
}

function formatBytes(bytes: number): string {
  if (bytes < 1024)        return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ─── Component ──────────────────────────────────────────────────────────────────
export default function UploadModal({ isOpen, onClose, onUploadSuccess, onViewJobs, onOpenAnalysis }: UploadModalProps) {
  const [stage, setStage]           = useState<UploadStage>('idle');
  const [errorMsg, setErrorMsg]     = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parcelCount, setParcelCount]   = useState(0);
  const [imageAnnotationCount, setImageAnnotationCount] = useState(0);
  const [isDragging, setIsDragging]     = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [fileKind, setFileKind] = useState<'geojson' | 'imagery'>('geojson');
  const [jobId, setJobId] = useState<string | null>(null);
  const [completionNotice, setCompletionNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const reset = useCallback(() => {
    setStage('idle');
    setErrorMsg('');
    setSelectedFile(null);
    setParcelCount(0);
    setImageAnnotationCount(0);
    setUploadProgress(0);
    setFileKind('geojson');
    setJobId(null);
    setCompletionNotice(null);
    if (inputRef.current) inputRef.current.value = '';
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const processFile = useCallback(async (file: File) => {
    // ── Stage 1: Client-side validation ────────────────────────────────────
    setStage('validating');
    setErrorMsg('');

    const validationError = validateFile(file);
    if (validationError) {
      setErrorMsg(validationError);
      setStage('error');
      return;
    }

    setSelectedFile(file);

    const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
    const isImagery = IMAGE_EXTENSIONS.includes(extension) || file.type.startsWith('image/');
    setFileKind(isImagery ? 'imagery' : 'geojson');

    if (isImagery) {
      setStage('uploading');
      const previewPromise = createAnalysisPreviewUrl(file).catch(() => null);
      try {
        type ImageryResult = {
          uploadId?: string;
          parcelCount?: number;
          imageAnnotationCount?: number;
          imageAnnotations?: ImageAnnotation[];
          jobId?: string;
          processingMode?: 'demo' | 'model';
          processingNotice?: string | null;
          georeferencing?: { isGeoreferenced?: boolean; sourceCrs?: string | null; warning?: string | null };
          error?: string;
        };
        let result: ImageryResult;
        if (file.size <= FAST_LOCAL_UPLOAD_BYTES) {
          setUploadProgress(100);
          setStage('processing');
          result = await processImageryFile<ImageryResult>(file);
        } else {
          const staged = await uploadImageryDirect(file, setUploadProgress);
          setUploadProgress(100);
          setStage('processing');
          result = await processStagedImagery<ImageryResult>(staged);
        }

        const insertedCount = result.parcelCount ?? 0;
        setParcelCount(insertedCount);
        setImageAnnotationCount(result.imageAnnotationCount ?? 0);
        setJobId(result.jobId ?? null);
        if (result.processingMode === 'demo') {
          const locationNotice = result.georeferencing?.isGeoreferenced
            ? ` The image footprint was located${result.georeferencing.sourceCrs ? ` using ${result.georeferencing.sourceCrs}` : ''}.`
            : ` ${result.georeferencing?.warning || 'The image cannot be placed accurately on the map.'}`;
          setCompletionNotice(`${result.processingNotice || 'No automatic boundaries were created because a trained model is not connected.'}${locationNotice}`);
        } else if (result.georeferencing?.isGeoreferenced) {
          setCompletionNotice(`Image located on the map${result.georeferencing.sourceCrs ? ` using ${result.georeferencing.sourceCrs}` : ''}.`);
        } else {
          setCompletionNotice(result.georeferencing?.warning || 'Image processed, but it cannot be placed accurately on the map.');
        }
        setStage('done');
        onUploadSuccess?.({
          uploadId: result.uploadId ?? null,
          filename: file.name,
          fileKind: 'imagery',
          parcelCount: insertedCount,
          imageAnnotationCount: result.imageAnnotationCount ?? 0,
          imageAnnotations: result.imageAnnotations ?? [],
          jobId: result.jobId ?? null,
          processingMode: result.processingMode ?? null,
          isGeoreferenced: result.georeferencing?.isGeoreferenced === true,
          sourceFile: file,
          analysisPreviewUrl: await previewPromise,
        });
      } catch (err: unknown) {
        const unusedPreview = await previewPromise;
        if (unusedPreview) URL.revokeObjectURL(unusedPreview);
        setErrorMsg(err instanceof Error ? err.message : 'Image processing failed.');
        setStage('error');
      } finally {
        if (inputRef.current) inputRef.current.value = '';
      }
      return;
    }

    // ── Stage 2: Parse GeoJSON ──────────────────────────────────────────────
    setStage('processing');

    try {
      const fileContent = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result as string);
        reader.onerror = () => reject(new Error('Failed to read file on client side.'));
        reader.readAsText(file);
      });

      let geojson: GeoJSON.FeatureCollection<GeoJSON.Geometry>;
      try {
        geojson = JSON.parse(fileContent) as GeoJSON.FeatureCollection<GeoJSON.Geometry>;
      } catch {
        throw new Error('Invalid JSON format. Please ensure the file is valid GeoJSON.');
      }

      if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
        throw new Error('GeoJSON must be a FeatureCollection with a features array.');
      }

      const response = await apiFetch('/api/import-parcels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/geo+json' },
        body: fileContent,
      });
      const result = await response.json() as { parcelCount?: number; error?: string };
      if (!response.ok) throw new Error(result.error || `Import failed with status ${response.status}`);
      const insertedCount = result.parcelCount ?? 0;

      setParcelCount(insertedCount);
      setImageAnnotationCount(0);
      setStage('done');
      onUploadSuccess?.({
        uploadId: null,
        filename: file.name,
        fileKind: 'geojson',
        parcelCount: insertedCount,
        imageAnnotationCount: 0,
        imageAnnotations: [],
        jobId: null,
        processingMode: null,
        isGeoreferenced: false,
        sourceFile: null,
      });
      window.setTimeout(handleClose, 800);
    } catch (err: unknown) {
      console.error('[UploadModal] processing error:', err);
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.';
      setErrorMsg(msg);
      setStage('error');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
      // State is already set to 'done' or 'error' which stops the loading spinners.
    }
  }, [handleClose, onUploadSuccess]);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  // ── Drag & Drop handlers ──────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = ()                   => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  if (!isOpen) return null;

  // ─── Stage content ──────────────────────────────────────────────────────────
  const stageContent = () => {
    switch (stage) {
      case 'idle':
      case 'validating':
        return (
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
            className={`flex flex-col items-center justify-center h-52 border-2 border-dashed rounded-xl cursor-pointer transition-all
              ${isDragging
                ? 'border-indigo-500 bg-indigo-500/10'
                : 'border-slate-700 bg-slate-800/40 hover:border-indigo-500/60 hover:bg-slate-800/70'
              }`}
          >
            <input
              ref={inputRef}
              type="file"
              className="hidden"
              accept=".geojson,.json,.jpg,.jpeg,.png,.tif,.tiff,application/geo+json,application/json,image/jpeg,image/png,image/tiff"
              onChange={onInputChange}
            />
            {stage === 'validating' ? (
              <Loader2 className="w-10 h-10 text-indigo-400 animate-spin mb-3" />
            ) : (
              <UploadCloud className="w-12 h-12 text-slate-500 mb-3" />
            )}
            <p className="text-sm font-medium text-slate-300">
              {stage === 'validating' ? 'Validating file…' : (
                <><span className="text-indigo-400 font-semibold">Click to upload</span> or drag &amp; drop</>
              )}
            </p>
            <p className="text-xs text-slate-500 mt-1">GeoJSON · JPG · PNG · TIFF · Max 25 MB</p>
          </div>
        );

      case 'uploading':
        return (
          <div className="flex flex-col items-center justify-center h-52 bg-slate-800/30 border border-slate-700 rounded-xl">
            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-3" />
            <p className="text-slate-200 font-medium text-sm">Uploading to Supabase Storage…</p>
            <div className="mt-3 h-2 w-64 overflow-hidden rounded-full bg-slate-700">
              <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
            <p className="mt-1 font-mono text-xs text-indigo-300">{uploadProgress}%</p>
            {selectedFile && (
              <div className="mt-3 flex items-center gap-2 px-3 py-1.5 bg-slate-700/50 rounded-lg">
                <FileImage className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="text-xs text-slate-400 max-w-[240px] truncate">{selectedFile.name}</span>
                <span className="text-xs text-slate-500">({formatBytes(selectedFile.size)})</span>
              </div>
            )}
          </div>
        );

      case 'processing':
        return (
          <div className="flex flex-col items-center justify-center h-52 bg-slate-800/30 border border-amber-500/20 rounded-xl">
            <div className="relative mb-4">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
                <Cpu className="w-6 h-6 text-amber-400" />
              </div>
              <div className="absolute inset-0 w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin" />
            </div>
            <p className="text-amber-300 font-semibold text-sm">{fileKind === 'imagery' ? 'Running AI Extraction Pipeline…' : 'Importing GeoJSON Parcels…'}</p>
            <p className="text-slate-500 text-xs mt-1">{fileKind === 'imagery' ? 'The processing job is being tracked automatically' : 'Validating cadastral boundaries'}</p>
          </div>
        );

      case 'done':
        return (
          <div className="flex min-h-52 flex-col items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-900/20 px-4 py-5 text-center">
            <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-3">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
            </div>
            <p className="text-emerald-400 font-bold text-lg">
              {fileKind === 'imagery' && completionNotice?.includes('Demo') ? 'Demo Processing Complete' : 'Processing Complete'}
            </p>
            {selectedFile && (
              <p className="mt-1 max-w-full truncate text-sm font-semibold text-slate-200" title={selectedFile.name}>
                {selectedFile.name}
              </p>
            )}
            <p className="text-slate-400 text-sm mt-1">
              {fileKind === 'imagery'
                ? `${parcelCount + imageAnnotationCount} model boundar${parcelCount + imageAnnotationCount === 1 ? 'y' : 'ies'} ready for review.`
                : `${parcelCount} parcel${parcelCount === 1 ? '' : 's'} added to the Triage Queue.`}
            </p>
            {jobId && <p className="mt-2 font-mono text-[10px] text-slate-500">Job {jobId.slice(0, 8)} completed</p>}
            {completionNotice && <p className="mt-2 max-w-sm text-xs text-amber-300">{completionNotice}</p>}
          </div>
        );

      case 'error':
        return (
          <div className="flex flex-col items-center justify-center h-52 bg-rose-900/10 border border-rose-500/30 rounded-xl px-4 text-center">
            <AlertCircle className="w-10 h-10 text-rose-400 mb-3" />
            <p className="text-rose-300 font-semibold text-sm">Upload Failed</p>
            <p className="text-rose-300/70 text-xs mt-1 max-w-sm">{errorMsg}</p>
            <button
              onClick={reset}
              className="mt-4 px-4 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        );
    }
  };

  return (
    /* ── Backdrop ──────────────────────────────────────────────────────────── */
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={handleClose}
    >
      {/* ── Panel ────────────────────────────────────────────────────────── */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Upload survey data"
        className="relative w-full max-w-lg mx-4 bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl p-6"
        onClick={e => e.stopPropagation()} 
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-slate-100 tracking-tight">Upload Survey Data</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              Upload drone imagery for AI processing or import GeoJSON parcels.
            </p>
          </div>
          <button
            onClick={handleClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors ml-3 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stage content */}
        {stageContent()}

        {/* Footer actions */}
        <div className="mt-5 flex items-center justify-between">
          {stage === 'done' ? (
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <button
                onClick={reset}
                className="px-4 py-2 text-sm bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
              >
                Upload Another
              </button>
              <button
                onClick={() => {
                  handleClose();
                  if (fileKind === 'imagery') onOpenAnalysis?.();
                }}
                className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-semibold transition-colors"
              >
                {fileKind === 'imagery' ? 'Open Image Analysis' : 'Go to Triage Queue'}
                <ArrowRight className="w-4 h-4" />
              </button>
              {fileKind === 'imagery' && onViewJobs && (
                <button type="button" onClick={() => { handleClose(); onViewJobs(); }} className="w-full text-center text-xs font-semibold text-slate-400 hover:text-slate-200">
                  View upload job details
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-3 ml-auto">
              <button
                onClick={handleClose}
                disabled={stage === 'uploading' || stage === 'processing'}
                className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-40"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
