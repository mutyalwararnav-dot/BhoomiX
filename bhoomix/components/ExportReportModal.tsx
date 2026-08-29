'use client';

import { useMemo } from 'react';
import {
  X, Download, Printer, MapPin, Cpu, Ruler,
  CheckCircle, Clock, AlertTriangle, FileCheck,
} from 'lucide-react';
import type { ParcelFeature, ParcelStatus } from '@/lib/supabase';

// ─── Geometry helpers ───────────────────────────────────────────────────────────

/**
 * Shoelace formula for the signed area of a ring in degrees².
 * We convert to metres using a simple approximation based on latitude.
 */
function computeAreaSqM(polygon: GeoJSON.Polygon): number {
  const ring = polygon.coordinates[0];
  if (!ring || ring.length < 3) return 0;

  // Approx centre latitude for conversion
  const avgLat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const metersPerDegLat = 111_320;
  const metersPerDegLng = 111_320 * Math.cos((avgLat * Math.PI) / 180);

  // Shoelace sum in degrees²
  let area = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    area += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]);
  }
  const areaDeg2 = Math.abs(area) / 2;

  // Convert: 1 deg² ≈ metersPerDegLat × metersPerDegLng
  return areaDeg2 * metersPerDegLat * metersPerDegLng;
}

function sqmToAcres(sqm: number): number {
  return sqm / 4046.86;
}

// ─── Status display helpers ─────────────────────────────────────────────────────
interface StatusMeta { label: string; color: string; bg: string; Icon: React.ElementType }
const STATUS_MAP: Record<ParcelStatus, StatusMeta> = {
  ai_suggestion:   { label: 'AI Suggestion',   color: 'text-amber-400',   bg: 'bg-amber-400/10 border-amber-400/30',   Icon: Cpu },
  conflict:        { label: 'Conflict',         color: 'text-rose-400',    bg: 'bg-rose-400/10  border-rose-400/30',    Icon: AlertTriangle },
  confirmed:       { label: 'Confirmed',        color: 'text-emerald-400', bg: 'bg-emerald-400/10 border-emerald-400/30', Icon: CheckCircle },
  pending:         { label: 'Pending Review',   color: 'text-slate-400',   bg: 'bg-slate-400/10 border-slate-400/30',   Icon: Clock },
  reviewed_edited: { label: 'Reviewed & Edited',color: 'text-indigo-400',  bg: 'bg-indigo-400/10 border-indigo-400/30', Icon: FileCheck },
  rejected:        { label: 'Rejected',         color: 'text-slate-400',   bg: 'bg-slate-400/10 border-slate-400/30',   Icon: X },
};

// ─── Download helpers ───────────────────────────────────────────────────────────
function downloadGeoJSON(parcel: ParcelFeature) {
  const feature: GeoJSON.Feature = {
    type:       'Feature',
    id:         parcel.properties.id,
    geometry:   parcel.geometry,
    properties: {
      ...parcel.properties,
      exported_at: new Date().toISOString(),
      source:      'BhoomiX AI Cadastral System',
    },
  };
  const blob = new Blob([JSON.stringify(feature, null, 2)], { type: 'application/geo+json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `bhoomix_parcel_${parcel.properties.id}.geojson`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Props ──────────────────────────────────────────────────────────────────────
interface ExportReportModalProps {
  parcel: ParcelFeature | null;
  isOpen: boolean;
  onClose: () => void;
}

// ─── Component ──────────────────────────────────────────────────────────────────
export default function ExportReportModal({ parcel, isOpen, onClose }: ExportReportModalProps) {
  const areaSqM = useMemo(() => parcel ? computeAreaSqM(parcel.geometry) : 0, [parcel]);
  const displayArea = parcel?.properties.computed_area_sqm ?? areaSqM;
  const areaAcres = sqmToAcres(displayArea);
  const exportedAt = useMemo(() => new Date().toLocaleString('en-IN', {
    dateStyle: 'long', timeStyle: 'short', timeZone: 'Asia/Kolkata',
  }), []);

  if (!isOpen || !parcel) return null;

  const { id, status, confidence_score, land_use } = parcel.properties;
  const statusMeta = STATUS_MAP[status] ?? STATUS_MAP.pending;
  const StatusIcon = statusMeta.Icon;

  return (
    <>
      {/* ── Print-only styles injected via a <style> tag ─────────────────── */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          #bhoomix-print-target {
            visibility: visible !important;
            position: absolute; inset: 0; z-index: 99999;
            width: 100%; max-width: none; border: 0; border-radius: 0;
            max-height: none; overflow: visible;
            background: white; padding: 32px;
            font-family: 'Segoe UI', sans-serif; color: #0f172a;
          }
          #bhoomix-print-target * { visibility: visible !important; color: #0f172a !important; }
          #bhoomix-print-target > div { background: white !important; }
          .no-print { display: none !important; }
          .print-card { box-shadow: none !important; border: 1px solid #e2e8f0 !important; }
        }
      `}</style>

      {/* ── Backdrop ─────────────────────────────────────────────────────── */}
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/75 py-4 backdrop-blur-sm sm:items-center"
        onClick={onClose}
      >
        {/* ── Modal panel ────────────────────────────────────────────────── */}
        <div
          id="bhoomix-print-target"
          className="relative mx-4 max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
          onClick={e => e.stopPropagation()}
        >
          {/* ─── Modal header ─────────────────────────────────────────────── */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/60 no-print">
            <div>
              <h2 className="text-lg font-bold text-slate-100 tracking-tight">Cadastral Property Report</h2>
              <p className="text-slate-400 text-xs mt-0.5">BhoomiX AI Land Survey System · Official Export</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* ─── Report card (also used for print) ────────────────────────── */}
          <div className="p-6 space-y-5 print-card">

            {/* Watermark / logo row */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
                  <MapPin className="w-4 h-4 text-white" />
                </div>
                <div>
                  <div className="text-xs font-bold text-indigo-400 tracking-widest uppercase">BhoomiX</div>
                  <div className="text-[10px] text-slate-500">AI Cadastral Intelligence Platform</div>
                </div>
              </div>
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-semibold ${statusMeta.bg} ${statusMeta.color}`}>
                <StatusIcon className="w-3.5 h-3.5" />
                {statusMeta.label}
              </div>
            </div>

            <div className="border-t border-slate-800" />

            {/* Parcel ID */}
            <div>
              <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">Parcel Identifier</div>
              <div className="font-mono text-2xl font-bold text-slate-100 tracking-tight">{id}</div>
            </div>

            {/* Grid of details */}
            <div className="grid grid-cols-2 gap-4">
              {/* Confidence score */}
              <ReportField
                label="AI Confidence Score"
                icon={<Cpu className="w-3.5 h-3.5" />}
                value={confidence_score != null
                  ? `${(confidence_score * 100).toFixed(1)}%`
                  : '—'}
              >
                {confidence_score != null && (
                  <div className="mt-2 w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-amber-500 to-indigo-500"
                      style={{ width: `${confidence_score * 100}%` }}
                    />
                  </div>
                )}
              </ReportField>

              {/* Region */}
              <ReportField
                label="Region / District"
                icon={<MapPin className="w-3.5 h-3.5" />}
                value="Pune, Maharashtra"
              />

              {/* Area in sqm */}
              <ReportField
                label="Approx. Area"
                icon={<Ruler className="w-3.5 h-3.5" />}
                value={`${displayArea.toFixed(1)} m²`}
              >
                <div className="text-xs text-slate-500 mt-0.5">{areaAcres.toFixed(4)} acres</div>
              </ReportField>

              {/* Land use */}
              <ReportField
                label="Land Use Classification"
                icon={<FileCheck className="w-3.5 h-3.5" />}
                value={land_use ? land_use.charAt(0).toUpperCase() + land_use.slice(1) : 'Unknown'}
              />
            </div>

            {/* Coordinates preview */}
            <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-3">
              <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-2">
                Boundary Centroid (WGS84 · EPSG:4326)
              </div>
              <CentroidDisplay polygon={parcel.geometry} />
            </div>

            <div className="border-t border-slate-800" />

            {/* Footer — timestamp + signature */}
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">Generated At</div>
                <div className="text-slate-300 font-mono">{exportedAt}</div>
                <div className="text-slate-500 mt-0.5">Indian Standard Time (IST)</div>
              </div>
              <div>
                <div className="text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1">Surveyor Sign-off</div>
                <div className="h-8 border-b border-slate-600 border-dashed mt-2" />
                <div className="text-slate-500 mt-1">Name &amp; Registration No.</div>
              </div>
            </div>

            {/* Legal disclaimer */}
            <div className="text-[9px] text-slate-600 leading-relaxed border-t border-slate-800 pt-3">
              This document is an AI-generated cadastral summary produced by BhoomiX. It is intended for internal surveying and
              verification purposes only. Final legal boundaries must be confirmed by a licensed surveyor in accordance with
              applicable land registration laws. Coordinate accuracy: ±3 metres RMSE.
            </div>
          </div>

          {/* ─── Action buttons ────────────────────────────────────────────── */}
          <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-slate-800 bg-slate-950/95 px-6 py-4 backdrop-blur no-print">
            <button
              onClick={() => downloadGeoJSON(parcel)}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 text-slate-200 text-sm font-semibold transition-all"
            >
              <Download className="w-4 h-4 text-indigo-400" />
              Download GeoJSON
            </button>
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold shadow-lg shadow-indigo-500/20 transition-all"
            >
              <Printer className="w-4 h-4" />
              Print Official Report
            </button>
            <button
              onClick={onClose}
              className="ml-auto text-sm text-slate-500 hover:text-slate-300 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────────

function ReportField({
  label, icon, value, children,
}: {
  label: string;
  icon: React.ReactNode;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="bg-slate-800/40 border border-slate-700/60 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-1.5">
        {icon}
        {label}
      </div>
      <div className="text-slate-200 font-semibold text-sm">{value}</div>
      {children}
    </div>
  );
}

function CentroidDisplay({ polygon }: { polygon: GeoJSON.Polygon }) {
  const coords = useMemo(() => {
    const sourceRing = polygon.coordinates[0];
    const ring = sourceRing.length > 1 &&
      sourceRing[0][0] === sourceRing[sourceRing.length - 1][0] &&
      sourceRing[0][1] === sourceRing[sourceRing.length - 1][1]
      ? sourceRing.slice(0, -1)
      : sourceRing;
    if (!ring?.length) return null;
    const lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    return { lng, lat };
  }, [polygon]);

  if (!coords) return <span className="text-slate-500 text-xs">—</span>;

  return (
    <div className="flex items-center gap-6">
      <div>
        <div className="text-[10px] text-slate-500 mb-0.5">Longitude</div>
        <div className="font-mono text-sm text-slate-200">{coords.lng.toFixed(6)}°</div>
      </div>
      <div>
        <div className="text-[10px] text-slate-500 mb-0.5">Latitude</div>
        <div className="font-mono text-sm text-slate-200">{coords.lat.toFixed(6)}°</div>
      </div>
      <div>
        <div className="text-[10px] text-slate-500 mb-0.5">Datum</div>
        <div className="font-mono text-sm text-slate-300">WGS84</div>
      </div>
    </div>
  );
}
