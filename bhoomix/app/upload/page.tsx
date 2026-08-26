'use client';

import { useState } from 'react';
import { UploadCloud, CheckCircle, Loader2 } from 'lucide-react';

export default function UploadPage() {
  const [status, setStatus] = useState<'idle' | 'uploading' | 'processing' | 'ready'>('idle');

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    
    setStatus('uploading');
    
    // Simulate upload delay
    setTimeout(() => {
      setStatus('processing');
      
      // Simulate AI Extraction delay 
      setTimeout(() => {
        setStatus('ready');
      }, 3000);
      
    }, 1500);
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full bg-slate-950 p-6">
      <div className="max-w-xl w-full bg-slate-900 border border-slate-800 rounded-xl p-8 shadow-2xl">
        <h2 className="text-2xl font-bold text-white mb-2">Upload Drone Imagery</h2>
        <p className="text-slate-400 mb-8 text-sm">Upload high-resolution orthomosaics (GeoTIFF, JPG, PNG) for AI boundary extraction.</p>
        
        {status === 'idle' && (
          <label className="flex flex-col items-center justify-center w-full h-64 border-2 border-slate-700 border-dashed rounded-lg cursor-pointer bg-slate-800/50 hover:bg-slate-800 hover:border-indigo-500 transition-all">
            <div className="flex flex-col items-center justify-center pt-5 pb-6">
              <UploadCloud className="w-12 h-12 text-slate-400 mb-4" />
              <p className="mb-2 text-sm text-slate-300"><span className="font-semibold text-indigo-400">Click to upload</span> or drag and drop</p>
              <p className="text-xs text-slate-500">GeoTIFF, PNG, JPG (MAX. 500MB)</p>
            </div>
            <input type="file" className="hidden" accept="image/*,.tiff" onChange={handleFileUpload} />
          </label>
        )}

        {status === 'uploading' && (
          <div className="flex flex-col items-center justify-center h-64 bg-slate-800/30 border border-slate-700 rounded-lg">
            <Loader2 className="w-10 h-10 text-indigo-500 animate-spin mb-4" />
            <p className="text-slate-300 font-medium">Uploading imagery to PostGIS...</p>
          </div>
        )}

        {status === 'processing' && (
          <div className="flex flex-col items-center justify-center h-64 bg-slate-800/30 border border-slate-700 rounded-lg">
            <div className="w-10 h-10 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <p className="text-amber-400 font-medium">Running AI Extraction Pipeline...</p>
            <p className="text-slate-500 text-xs mt-2">Identifying cadastral boundaries</p>
          </div>
        )}

        {status === 'ready' && (
          <div className="flex flex-col items-center justify-center h-64 bg-emerald-900/20 border border-emerald-500/30 rounded-lg text-center">
            <CheckCircle className="w-12 h-12 text-emerald-500 mb-4 mx-auto" />
            <p className="text-emerald-400 font-medium text-lg">Extraction Complete!</p>
            <p className="text-slate-400 text-sm mt-2 mb-6">AI suggestions successfully generated.</p>
            <a href="/" className="px-6 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-md font-medium transition-colors">
              Return to Surveyor Workspace
            </a>
          </div>
        )}
      </div>
    </div>
  );
}