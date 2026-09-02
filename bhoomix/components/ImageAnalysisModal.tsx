'use client';

import { Check, Edit3, ImageIcon, Loader2, Plus, RotateCcw, Save, ShieldAlert, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api-fetch';
import type { ImageAnnotation, ImageAnnotationPoint, ImageAnnotationStatus } from '@/lib/image-annotations';

interface ImageAnalysisModalProps {
  uploadId: string | null;
  filename: string;
  imageUrl: string;
  processingMode: 'demo' | 'model' | null;
  initialAnnotations?: ImageAnnotation[];
  onClose: () => void;
}

function polygonCenter(points: ImageAnnotationPoint[]) {
  return points.reduce((center, point) => ({
    x: center.x + point.x / points.length,
    y: center.y + point.y / points.length,
  }), { x: 0, y: 0 });
}

function cloneAnnotations(annotations: ImageAnnotation[]) {
  return annotations.map((annotation) => ({ ...annotation, points: annotation.points.map((point) => ({ ...point })) }));
}

export default function ImageAnalysisModal({ uploadId, filename, imageUrl, processingMode, initialAnnotations, onClose }: ImageAnalysisModalProps) {
  const initial = initialAnnotations?.length ? cloneAnnotations(initialAnnotations) : [];
  const [polygons, setPolygons] = useState<ImageAnnotation[]>(initial);
  const [baselinePolygons, setBaselinePolygons] = useState<ImageAnnotation[]>(cloneAnnotations(initial));
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draggingVertex, setDraggingVertex] = useState<{ polygonId: string; pointIndex: number } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadingAnnotations, setLoadingAnnotations] = useState(Boolean(uploadId) && initial.length === 0);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [savingAnnotations, setSavingAnnotations] = useState(false);
  const [persistenceMessage, setPersistenceMessage] = useState(initial.length > 0
    ? `${initial.length} model polygon${initial.length === 1 ? '' : 's'} ready immediately.`
    : '');

  useEffect(() => {
    let active = true;
    if (!uploadId) return;
    void (async () => {
      try {
        const response = await apiFetch(`/api/imagery/${uploadId}/annotations`, { cache: 'no-store' });
        const payload = await response.json() as { annotations?: ImageAnnotation[]; error?: string };
        if (!response.ok) throw new Error(payload.error || 'Saved image polygons could not be loaded.');
        if (active) {
          const saved = cloneAnnotations(payload.annotations ?? []);
          setPolygons(saved);
          setBaselinePolygons(cloneAnnotations(saved));
          setSelectedId(saved[0]?.id ?? null);
          setEditingId(null);
          setPersistenceMessage(saved.length > 0
            ? `${saved.length} model or saved polygon${saved.length === 1 ? '' : 's'} loaded.`
            : processingMode === 'model'
              ? 'The model returned no valid boundaries for this image. You can add a manual polygon for review.'
              : 'No automatic boundaries were created because a trained model is not connected. Use Add Polygon to label this image manually.');
        }
      } catch (error: unknown) {
        if (active) setPersistenceMessage(error instanceof Error ? error.message : 'Saved image polygons could not be loaded.');
      } finally {
        if (active) setLoadingAnnotations(false);
      }
    })();
    return () => { active = false; };
  }, [initialAnnotations, processingMode, uploadId]);

  const selected = polygons.find((polygon) => polygon.id === selectedId) ?? null;

  const updateStatus = (status: ImageAnnotationStatus) => {
    if (!selectedId) return;
    setPolygons((current) => current.map((polygon) => polygon.id === selectedId ? { ...polygon, status } : polygon));
    setDirty(true);
  };

  const addPolygon = () => {
    const manualCount = polygons.filter((polygon) => polygon.source === 'manual').length;
    const offset = (manualCount % 5) * 35;
    const polygon: ImageAnnotation = {
      id: `MANUAL-${String(manualCount + 1).padStart(3, '0')}`,
      confidence: null,
      status: 'pending',
      source: 'manual',
      points: [
        { x: 360 + offset, y: 360 + offset },
        { x: 610 + offset, y: 360 + offset },
        { x: 610 + offset, y: 600 + offset },
        { x: 360 + offset, y: 600 + offset },
      ],
    };
    setPolygons((current) => [...current, polygon]);
    setSelectedId(polygon.id);
    setEditingId(polygon.id);
    setDirty(true);
  };

  const moveVertex = (event: React.PointerEvent<SVGSVGElement>) => {
    if (!draggingVertex) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const point = {
      x: Math.max(0, Math.min(1000, ((event.clientX - bounds.left) / bounds.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((event.clientY - bounds.top) / bounds.height) * 1000)),
    };
    setPolygons((current) => current.map((polygon) => {
      if (polygon.id !== draggingVertex.polygonId) return polygon;
      return {
        ...polygon,
        confidence: polygon.source === 'demo' ? null : polygon.confidence,
        source: polygon.source === 'demo' ? 'manual' : polygon.source,
        points: polygon.points.map((existing, index) => index === draggingVertex.pointIndex ? point : existing),
      };
    }));
    setDirty(true);
  };

  const saveAnnotations = async () => {
    if (!uploadId) {
      setPersistenceMessage('This upload has no persistent identifier. Upload the image again to save its polygons.');
      return;
    }
    setSavingAnnotations(true);
    setPersistenceMessage('');
    try {
      const response = await apiFetch(`/api/imagery/${uploadId}/annotations`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ annotations: polygons }),
      });
      const payload = await response.json() as { annotationCount?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Image polygons could not be saved.');
      setBaselinePolygons(cloneAnnotations(polygons));
      setDirty(false);
      setPersistenceMessage(`${payload.annotationCount ?? polygons.length} polygon${(payload.annotationCount ?? polygons.length) === 1 ? '' : 's'} saved successfully.`);
    } catch (error: unknown) {
      setPersistenceMessage(error instanceof Error ? error.message : 'Image polygons could not be saved.');
    } finally {
      setSavingAnnotations(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-2 backdrop-blur-sm sm:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="image-analysis-title" className="flex h-[94dvh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-700 bg-[#0b1020] shadow-2xl">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-950 px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-300"><ImageIcon className="h-5 w-5" /></div>
            <div className="min-w-0">
              <h2 id="image-analysis-title" className="text-base font-bold text-white sm:text-lg">Image Analysis</h2>
              <p className="truncate text-xs text-slate-400" title={filename}>{filename}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${processingMode === 'model' ? 'border-emerald-400/30 bg-emerald-400/10 text-emerald-300' : 'border-amber-400/30 bg-amber-400/10 text-amber-300'}`}>
              {processingMode === 'model' ? 'AI model' : 'Manual review'}
            </span>
            <button type="button" onClick={onClose} title="Close image analysis" className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><X className="h-5 w-5" /></button>
          </div>
        </header>

        {processingMode !== 'model' && (
          <div className="flex items-start gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200 sm:px-5">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <p>No trained model is connected, so BhoomiX will not place random polygons on this image. Use Add Polygon to create accurate manual labels; model predictions will appear automatically after training.</p>
          </div>
        )}

        <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_280px]">
          <div className="flex min-h-0 items-center justify-center overflow-auto bg-black/60 p-3 sm:p-5">
            <div className="relative inline-block max-h-full max-w-full overflow-hidden rounded-xl border border-slate-700 bg-black shadow-2xl">
              {!imageLoaded && (
                <div className="absolute inset-0 z-10 flex min-h-64 min-w-64 items-center justify-center bg-slate-950 text-sm text-slate-300">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin text-cyan-300" /> Decoding image…
                </div>
              )}
              {/* eslint-disable-next-line @next/next/no-img-element -- object URLs are created from local user uploads. */}
              <img key={imageUrl} src={imageUrl} alt={`Uploaded imagery ${filename}`} className="block max-h-[72dvh] max-w-full select-none object-contain" draggable={false} decoding="async" onLoad={() => setImageLoaded(true)} />
              <svg
                viewBox="0 0 1000 1000"
                preserveAspectRatio="none"
                className="absolute inset-0 h-full w-full touch-none"
                onPointerMove={moveVertex}
                onPointerUp={() => setDraggingVertex(null)}
                onPointerCancel={() => setDraggingVertex(null)}
                onPointerLeave={() => setDraggingVertex(null)}
              >
                {polygons.map((polygon) => {
                  const isSelected = polygon.id === selectedId;
                  const isEditing = polygon.id === editingId;
                  const center = polygonCenter(polygon.points);
                  const stroke = polygon.status === 'rejected' ? '#fb7185' : polygon.status === 'approved' ? '#34d399' : isSelected ? '#fbbf24' : '#22d3ee';
                  return (
                    <g key={polygon.id} onPointerDown={() => { setSelectedId(polygon.id); if (!isSelected) setEditingId(null); }} className="cursor-pointer">
                      <polygon points={polygon.points.map((point) => `${point.x},${point.y}`).join(' ')} fill={stroke} fillOpacity={isSelected ? 0.28 : 0.16} stroke={stroke} strokeWidth={isSelected ? 5 : 3} vectorEffect="non-scaling-stroke" />
                      {isSelected && <>
                        <rect x={center.x - 54} y={center.y - 22} width="108" height="38" rx="8" fill="#020617" fillOpacity="0.88" />
                        <text x={center.x} y={center.y + 5} textAnchor="middle" fill="white" fontSize="24" fontWeight="700">{polygon.confidence === null ? 'MANUAL' : `${Math.round(polygon.confidence * 100)}%`}</text>
                      </>}
                      {isEditing && polygon.points.map((point, pointIndex) => (
                        <circle
                          key={`${polygon.id}-${pointIndex}`}
                          cx={point.x}
                          cy={point.y}
                          r="10"
                          fill="#ffffff"
                          stroke={stroke}
                          strokeWidth="5"
                          vectorEffect="non-scaling-stroke"
                          className="cursor-move"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            event.currentTarget.setPointerCapture(event.pointerId);
                            setDraggingVertex({ polygonId: polygon.id, pointIndex });
                          }}
                        />
                      ))}
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>

          <aside className="min-h-0 overflow-y-auto border-t border-slate-800 bg-slate-950/80 p-4 lg:border-l lg:border-t-0">
            <div className="mb-4 flex items-center justify-between gap-2">
              <div><p className="text-xs font-bold uppercase tracking-wider text-slate-400">Boundaries</p><p className="mt-1 text-2xl font-bold text-white">{polygons.length}</p></div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={addPolygon} className="flex items-center gap-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-400/20"><Plus className="h-4 w-4" />Add Polygon</button>
                <button type="button" onClick={() => { const restored = cloneAnnotations(baselinePolygons); setPolygons(restored); setSelectedId(restored[0]?.id ?? null); setEditingId(null); setDraggingVertex(null); setDirty(false); setPersistenceMessage('Unsaved changes were discarded.'); }} title="Discard unsaved polygon changes" className="rounded-lg border border-slate-700 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"><RotateCcw className="h-4 w-4" /></button>
              </div>
            </div>
            <p className="mb-4 text-[11px] leading-relaxed text-slate-500">Add Polygon creates a manual four-point boundary in the image. Drag its white handles into place, then approve it.</p>
            <button type="button" onClick={() => void saveAnnotations()} disabled={savingAnnotations || loadingAnnotations || !dirty} className="mb-3 flex w-full items-center justify-center gap-2 rounded-lg bg-indigo-600 px-3 py-2.5 text-xs font-bold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500">
              {savingAnnotations ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {savingAnnotations ? 'Saving polygons…' : dirty ? 'Save Changes' : 'All Changes Saved'}
            </button>
            {loadingAnnotations && <p className="mb-3 flex items-center gap-2 text-[11px] text-slate-400"><Loader2 className="h-3.5 w-3.5 animate-spin" />Loading saved polygons…</p>}
            {persistenceMessage && <p role="status" className="mb-3 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-[11px] leading-relaxed text-slate-300">{persistenceMessage}</p>}
            <div className="space-y-2">
              {!loadingAnnotations && polygons.length === 0 && (
                <div className="rounded-xl border border-dashed border-slate-700 bg-slate-900/40 p-4 text-center">
                  <p className="text-xs font-semibold text-slate-300">No boundaries yet</p>
                  <p className="mt-1 text-[11px] leading-relaxed text-slate-500">Choose Add Polygon, then drag its corner handles around one visible plot.</p>
                </div>
              )}
              {polygons.map((polygon) => (
                <button key={polygon.id} type="button" onClick={() => { setSelectedId(polygon.id); setEditingId(null); setDraggingVertex(null); }} className={`w-full rounded-xl border p-3 text-left transition ${polygon.id === selectedId ? 'border-indigo-400 bg-indigo-500/10' : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-mono text-xs font-semibold text-slate-200">{polygon.id}</span><span className="text-xs font-bold text-cyan-300">{polygon.confidence === null ? 'Manual' : `${Math.round(polygon.confidence * 100)}%`}</span></div>
                  <p className={`mt-1 text-[10px] font-bold uppercase tracking-wider ${polygon.status === 'approved' ? 'text-emerald-300' : polygon.status === 'rejected' ? 'text-rose-300' : 'text-amber-300'}`}>{polygon.status}</p>
                </button>
              ))}
            </div>
            {selected && (
              <div className="mt-5 rounded-xl border border-slate-800 bg-slate-900/70 p-3">
                <button type="button" onClick={() => { setEditingId((current) => current === selected.id ? null : selected.id); setDraggingVertex(null); }} className={`mb-3 flex w-full items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${editingId === selected.id ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-indigo-400/30 bg-indigo-400/10 text-indigo-200 hover:bg-indigo-400/20'}`}>
                  <Edit3 className="h-4 w-4" />{editingId === selected.id ? 'Finish Editing' : 'Edit Boundary'}
                </button>
                <p className="mb-3 text-[11px] leading-relaxed text-slate-400">{editingId === selected.id ? 'Drag the white vertex handles, then choose Finish Editing.' : 'Selection is locked. Choose Edit Boundary before moving any vertex.'}</p>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => updateStatus('rejected')} className="flex items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs font-semibold text-rose-300 hover:bg-rose-500/20"><XCircle className="h-4 w-4" />Reject</button>
                  <button type="button" onClick={() => updateStatus('approved')} className="flex items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20"><Check className="h-4 w-4" />Approve</button>
                </div>
              </div>
            )}
          </aside>
        </div>
      </section>
    </div>
  );
}
