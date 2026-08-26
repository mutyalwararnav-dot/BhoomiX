'use client';

import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { supabase } from '@/lib/supabase';
import { Upload, FileImage, CheckCircle, AlertCircle, Loader2, Cpu, ArrowRight } from 'lucide-react';
import Link from 'next/link';

type UploadStatus = 'idle' | 'uploading' | 'success' | 'error';
type AIStatus = 'idle' | 'processing' | 'success' | 'error';

export default function UploadPage() {
  const [status, setStatus] = useState<UploadStatus>('idle');
  const [progress, setProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState('');
  
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [aiStatus, setAiStatus] = useState<AIStatus>('idle');
  const [aiError, setAiError] = useState('');

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    const file = acceptedFiles[0];
    setStatus('uploading');
    setProgress(0);
    setErrorMessage('');
    setAiStatus('idle');
    setUploadId(null);

    try {
      // 1. Upload to Supabase Storage
      const fileName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
      const filePath = `uploads/${fileName}`;

      const progressInterval = setInterval(() => {
        setProgress(p => Math.min(p + 10, 90));
      }, 500);

      const { data: storageData, error: storageError } = await supabase.storage
        .from('drone_datasets')
        .upload(filePath, file, {
          cacheControl: '3600',
          upsert: false
        });

      clearInterval(progressInterval);

      if (storageError) {
        throw new Error(storageError.message);
      }

      // 2. Insert into drone_uploads table
      const { data: dbData, error: dbError } = await supabase
        .from('drone_uploads')
        .insert({
          filename: file.name,
          file_path: storageData.path,
          status: 'uploaded'
        })
        .select()
        .single();

      if (dbError) {
        throw new Error(dbError.message);
      }

      setUploadId(dbData.id);
      setProgress(100);
      setStatus('success');
    } catch (err: any) {
      console.error('[Upload Error]', err);
      setErrorMessage(err.message || 'An unknown error occurred during upload.');
      setStatus('error');
    }
  }, []);

  const handleRunAI = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!uploadId) return;

    setAiStatus('processing');
    setAiError('');

    try {
      const res = await fetch('/api/process-imagery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ upload_id: uploadId })
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to process imagery');
      }

      setAiStatus('success');
    } catch (err: any) {
      console.error('[AI Processing Error]', err);
      setAiError(err.message || 'An unknown error occurred during AI processing.');
      setAiStatus('error');
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/tiff': ['.tiff', '.tif'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png']
    },
    maxFiles: 1
  });

  return (
    <div className="w-full h-full flex flex-col items-center justify-center bg-[#0B0F1A] p-6">
      <div className="max-w-2xl w-full">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-100 tracking-tight mb-2">Upload Drone Dataset</h1>
          <p className="text-slate-400">Upload high-resolution orthomosaics (TIFF, JPG, PNG) for AI cadastral extraction.</p>
        </div>

        {/* Dropzone Area */}
        <div 
          {...(status === 'idle' || status === 'error' ? getRootProps() : {})} 
          className={`
            relative overflow-hidden rounded-2xl border-2 border-dashed transition-all duration-200 ease-in-out
            flex flex-col items-center justify-center p-12 min-h-[320px] bg-[#111827]/80
            ${status === 'idle' || status === 'error' ? 'cursor-pointer' : ''}
            ${isDragActive ? 'border-indigo-500 bg-indigo-500/10' : 'border-[#2D3748]'}
            ${status === 'idle' && !isDragActive ? 'hover:border-indigo-500/50 hover:bg-[#1E2535]' : ''}
          `}
        >
          <input {...getInputProps()} disabled={status !== 'idle' && status !== 'error'} />

          {status === 'idle' || status === 'error' ? (
            <div className="flex flex-col items-center text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#1E2535] flex items-center justify-center mb-4 shadow-bhoomix-sm">
                <Upload className="w-8 h-8 text-indigo-400" />
              </div>
              <p className="text-lg font-medium text-slate-200 mb-1">
                {isDragActive ? 'Drop dataset here' : 'Drag & drop drone imagery'}
              </p>
              <p className="text-sm text-slate-500">or click to browse from your computer</p>
              
              <div className="mt-6 flex gap-3 text-xs font-mono text-slate-500">
                <span className="px-2 py-1 rounded bg-[#0B0F1A] border border-[#2D3748]">.TIFF</span>
                <span className="px-2 py-1 rounded bg-[#0B0F1A] border border-[#2D3748]">.JPG</span>
                <span className="px-2 py-1 rounded bg-[#0B0F1A] border border-[#2D3748]">.PNG</span>
              </div>
            </div>
          ) : status === 'uploading' ? (
            <div className="flex flex-col items-center w-full max-w-md">
              <Loader2 className="w-12 h-12 text-indigo-500 animate-spin mb-6" />
              <p className="text-slate-300 font-medium mb-4">Uploading dataset to BhoomiX Storage...</p>
              
              <div className="w-full h-2 bg-[#0B0F1A] rounded-full overflow-hidden border border-[#2D3748]">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-300 ease-out rounded-full"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-slate-500 mt-2 font-mono">{progress}%</p>
            </div>
          ) : (
            <div className="flex flex-col items-center text-center w-full">
              {aiStatus === 'idle' || aiStatus === 'error' ? (
                <>
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4 border border-emerald-500/20">
                    <CheckCircle className="w-8 h-8 text-emerald-500" />
                  </div>
                  <p className="text-xl font-bold text-emerald-400 mb-2">Upload Complete!</p>
                  <p className="text-slate-400 max-w-sm mb-6">Dataset securely stored. Ready for AI cadastral boundary extraction.</p>
                  
                  <button 
                    onClick={handleRunAI}
                    className="flex items-center gap-2 px-6 py-3 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-white font-semibold transition-all shadow-bhoomix-sm shadow-indigo-500/20"
                  >
                    <Cpu className="w-5 h-5" />
                    Run AI Extraction
                  </button>

                  {aiStatus === 'error' && (
                    <div className="mt-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 flex items-start gap-2 max-w-sm">
                      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                      <p className="text-xs text-rose-300 text-left">{aiError}</p>
                    </div>
                  )}
                </>
              ) : aiStatus === 'processing' ? (
                <div className="flex flex-col items-center w-full max-w-md">
                  <div className="relative mb-6">
                    <div className="w-16 h-16 rounded-full bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center animate-pulse">
                      <Cpu className="w-8 h-8 text-indigo-400" />
                    </div>
                    <Loader2 className="w-16 h-16 text-indigo-500 animate-spin absolute inset-0" />
                  </div>
                  <p className="text-slate-300 font-medium mb-2">AI analyzing visual boundary indicators...</p>
                  <p className="text-sm text-slate-500">Detecting roads, fences, and field geometries.</p>
                </div>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-4 border border-emerald-500/20 shadow-bhoomix-glow shadow-emerald-500/20">
                    <CheckCircle className="w-8 h-8 text-emerald-500" />
                  </div>
                  <p className="text-xl font-bold text-emerald-400 mb-2">AI Extraction Complete!</p>
                  <p className="text-slate-400 max-w-sm mb-8">Mock parcels successfully generated and injected into the database.</p>
                  
                  <Link 
                    href="/"
                    className="flex items-center gap-2 px-6 py-3 bg-[#1E2535] hover:bg-[#2D3748] border border-[#2D3748] rounded-lg text-slate-200 font-semibold transition-colors shadow-sm group"
                  >
                    Return to Surveyor Workspace
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-slate-200 transition-colors" />
                  </Link>
                </>
              )}
            </div>
          )}
        </div>

        {/* Upload Error State */}
        {status === 'error' && (
          <div className="mt-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
            <div>
              <h4 className="text-sm font-semibold text-rose-400">Upload Failed</h4>
              <p className="text-sm text-rose-300/80 mt-1">{errorMessage}</p>
            </div>
          </div>
        )}

        {status === 'idle' && (
          <div className="mt-8 text-center">
            <Link href="/" className="text-sm text-indigo-400 hover:text-indigo-300 font-medium transition-colors">
              ← Return to Dashboard
            </Link>
          </div>
        )}
        
      </div>
    </div>
  );
}
