'use client';

import { apiFetch } from '@/lib/api-fetch';

export interface StagedImagery {
  storagePath: string;
  filename: string;
  mimeType: string;
  size: number;
  lastModified: number;
}

interface UploadUrlResponse {
  storagePath?: string;
  signedUrl?: string;
  error?: string;
}

function browserMimeType(file: File) {
  if (file.type) return file.type;
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  return 'image/tiff';
}

export async function uploadImageryDirect(
  file: File,
  onProgress?: (percentage: number) => void,
  options?: { purpose?: 'imagery' | 'elevation'; layerType?: 'ori' | 'dsm' | 'dtm' },
): Promise<StagedImagery> {
  const mimeType = browserMimeType(file);
  const response = await apiFetch('/api/imagery/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      mimeType,
      size: file.size,
      purpose: options?.purpose ?? 'imagery',
      layerType: options?.layerType,
    }),
  });
  const payload = await response.json() as UploadUrlResponse;
  if (!response.ok || !payload.storagePath || !payload.signedUrl) {
    throw new Error(payload.error || 'A secure upload could not be started.');
  }

  await new Promise<void>((resolve, reject) => {
    const form = new FormData();
    form.append('cacheControl', '3600');
    form.append('', file);

    const xhr = new XMLHttpRequest();
    xhr.open('PUT', payload.signedUrl!);
    xhr.setRequestHeader('x-upsert', 'false');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error('Network error while uploading imagery.'));
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(100);
        resolve();
      } else {
        reject(new Error(`Storage upload failed with status ${xhr.status}.`));
      }
    };
    xhr.send(form);
  });

  return {
    storagePath: payload.storagePath,
    filename: file.name,
    mimeType,
    size: file.size,
    lastModified: file.lastModified,
  };
}

export async function processStagedImagery<T>(staged: StagedImagery): Promise<T> {
  const response = await apiFetch('/api/process-imagery', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(staged),
  });
  const payload = await response.json() as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || `Image processing failed with status ${response.status}.`);
  return payload;
}
