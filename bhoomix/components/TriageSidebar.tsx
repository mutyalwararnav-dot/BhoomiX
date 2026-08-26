'use client';

import { useEffect, useState } from 'react';
import { supabase, type ParcelFeature } from '@/lib/supabase';
import { Crosshair } from 'lucide-react';

interface TriageSidebarProps {
  onFlyTo: (parcel: ParcelFeature) => void;
  refreshTrigger: number;
}

export default function TriageSidebar({ onFlyTo, refreshTrigger }: TriageSidebarProps) {
  const [parcels, setParcels] = useState<ParcelFeature[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadParcels() {
      setIsLoading(true);
      const { data, error } = await supabase.rpc('get_parcels_as_geojson');
      if (error) {
        console.error('[BhoomiX] Sidebar fetch error:', error.message);
      } else if (data) {
        const fc = data as GeoJSON.FeatureCollection<GeoJSON.Polygon>;
        // Filter only those that need triage
        const triageParcels = (fc.features as ParcelFeature[]).filter(
          (f) => f.properties.status === 'ai_suggestion' || f.properties.status === 'conflict'
        );
        setParcels(triageParcels);
      }
      setIsLoading(false);
    }
    loadParcels();
  }, [refreshTrigger]);

  const aiSuggestions = parcels.filter(p => p.properties.status === 'ai_suggestion');
  const conflicts = parcels.filter(p => p.properties.status === 'conflict');

  return (
    <div className="w-full h-full bg-[#111827] border-r border-[#2D3748] flex flex-col overflow-hidden shadow-2xl z-20">
      <div className="p-5 border-b border-[#2D3748] shrink-0 bg-[#0B0F1A]">
        <h2 className="text-lg font-bold text-slate-200 tracking-tight">Surveyor Triage</h2>
        <p className="text-xs text-slate-500 mt-1">Review AI suggestions and resolve conflicts</p>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <>
            {/* Conflicts Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-[#F43F5E]" />
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  Conflicts ({conflicts.length})
                </h3>
              </div>
              <div className="space-y-3">
                {conflicts.map(parcel => (
                  <ParcelCard key={parcel.properties.id} parcel={parcel} onFlyTo={onFlyTo} />
                ))}
                {conflicts.length === 0 && (
                  <div className="text-xs text-slate-500 italic">No conflicts pending review.</div>
                )}
              </div>
            </div>

            {/* AI Suggestions Section */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="w-2 h-2 rounded-full bg-[#F59E0B]" />
                <h3 className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                  AI Suggestions ({aiSuggestions.length})
                </h3>
              </div>
              <div className="space-y-3">
                {aiSuggestions.map(parcel => (
                  <ParcelCard key={parcel.properties.id} parcel={parcel} onFlyTo={onFlyTo} />
                ))}
                {aiSuggestions.length === 0 && (
                  <div className="text-xs text-slate-500 italic">No AI suggestions pending review.</div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ParcelCard({ parcel, onFlyTo }: { parcel: ParcelFeature; onFlyTo: (parcel: ParcelFeature) => void }) {
  const { id, confidence_score, status } = parcel.properties;
  
  const isConflict = status === 'conflict';
  const badgeColors = isConflict
    ? 'text-[#F43F5E] bg-[#F43F5E]/10 border-[#F43F5E]/30'
    : 'text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/30';

  return (
    <div className="bg-[#1E2535] border border-[#2D3748] rounded-xl p-3 shadow-sm hover:border-indigo-500/50 transition-colors group">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-mono font-semibold text-slate-200">{id}</span>
        <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badgeColors} uppercase tracking-wider`}>
          {isConflict ? 'Conflict' : 'AI'}
        </span>
      </div>
      <div className="flex items-end justify-between mt-3">
        <div>
          <div className="text-[10px] text-slate-500 mb-0.5">Confidence Score</div>
          <div className="text-xs font-mono text-slate-300">
            {confidence_score != null ? (confidence_score * 100).toFixed(1) + '%' : 'N/A'}
          </div>
        </div>
        <button
          onClick={() => onFlyTo(parcel)}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2D3748] hover:bg-indigo-600 hover:text-white text-slate-300 text-xs rounded-lg transition-colors font-medium"
        >
          <Crosshair className="w-3.5 h-3.5" />
          Fly To
        </button>
      </div>
    </div>
  );
}
