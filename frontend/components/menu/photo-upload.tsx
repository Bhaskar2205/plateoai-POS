'use client';

import { ImagePlus, Link2, Loader2, Trash2, TriangleAlert, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { API_BASE_URL, ApiError, tokenStorage } from '@/lib/api';
import { cn } from '@/lib/cn';

/**
 * Choosing a dish photo.
 *
 * Restaurants have photos on a phone, not on a CDN, so taking a file is the main
 * path and pasting a link is the fallback for the few who already host their
 * images somewhere. The file goes straight to the API, which re-encodes it and
 * hands back a URL; nothing is saved to the dish until the form is saved, so
 * abandoning a half-filled form leaves the live menu alone.
 */

const ACCEPTED = 'image/jpeg,image/png,image/webp';
const MAX_BYTES = 8 * 1024 * 1024;

interface UploadResponse {
  url: string;
  width: number;
  height: number;
  bytes: number;
}

export function PhotoUpload({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (url: string) => void;
  error?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pasting, setPasting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const upload = async (file: File) => {
    setProblem(null);

    if (!ACCEPTED.split(',').includes(file.type)) {
      setProblem('Choose a JPEG, PNG or WebP photo.');
      return;
    }

    if (file.size > MAX_BYTES) {
      setProblem(`That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is 8 MB.`);
      return;
    }

    // Show the picked file immediately; the upload takes a moment on a phone.
    setPreview(URL.createObjectURL(file));
    setUploading(true);

    try {
      const body = new FormData();
      body.append('file', file);

      const response = await fetch(`${API_BASE_URL}/restaurants/me/uploads/dish-photo`, {
        method: 'POST',
        // No Content-Type: the browser sets the multipart boundary itself.
        headers: { ...(tokenStorage.get() ? { Authorization: `Bearer ${tokenStorage.get()}` } : {}) },
        body,
      });

      const text = await response.text();
      const payload = text ? (JSON.parse(text) as UploadResponse & { message?: string }) : null;

      if (!response.ok) {
        throw new ApiError(response.status, payload?.message ?? 'The photo could not be uploaded.');
      }

      onChange(payload!.url);
    } catch (uploadError) {
      setProblem(
        uploadError instanceof ApiError
          ? uploadError.message
          : 'The photo could not be uploaded. Check your connection and try again.',
      );
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const shown = preview ?? (value || null);

  return (
    <div className="space-y-2">
      <span className="block text-sm font-medium text-ink">Photo</span>

      {shown ? (
        <div className="flex items-start gap-3">
          <div className="relative size-28 shrink-0 overflow-hidden rounded-xl border border-line bg-ground">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={shown} alt="" className="size-full object-cover" />
            {uploading && (
              <div className="absolute inset-0 grid place-items-center bg-ink/40">
                <Loader2 className="size-5 animate-spin text-white" aria-hidden />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1 space-y-2">
            <p className="text-xs text-muted">
              {uploading ? 'Uploading…' : 'Looks good. Diners see this on your menu.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={uploading}
                onClick={() => inputRef.current?.click()}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-ground disabled:opacity-60"
              >
                <Upload className="size-4" aria-hidden />
                Replace
              </button>
              <button
                type="button"
                disabled={uploading}
                onClick={() => {
                  setPreview(null);
                  setProblem(null);
                  onChange('');
                }}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-muted hover:text-danger-600 disabled:opacity-60"
              >
                <Trash2 className="size-4" aria-hidden />
                Remove
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            const file = event.dataTransfer.files?.[0];
            if (file) void upload(file);
          }}
          className={cn(
            'rounded-xl border-2 border-dashed transition-colors',
            dragging ? 'border-brand-500 bg-brand-50' : 'border-line bg-ground/50',
          )}
        >
          <button
            type="button"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="flex w-full flex-col items-center gap-1.5 px-4 py-6 text-center"
          >
            {uploading ? (
              <Loader2 className="size-6 animate-spin text-brand-600" aria-hidden />
            ) : (
              <ImagePlus className="size-6 text-brand-600" aria-hidden />
            )}
            <span className="text-sm font-medium text-ink">
              {uploading ? 'Uploading…' : 'Add a photo of this dish'}
            </span>
            <span className="text-xs text-muted">
              Tap to choose, or drag one here. JPEG, PNG or WebP, up to 8 MB.
            </span>
          </button>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED}
        className="sr-only"
        aria-label="Choose a dish photo"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
          // Let the same file be picked again after a failure.
          event.target.value = '';
        }}
      />

      {(problem || error) && (
        <p role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger-600">
          <TriangleAlert className="mt-px size-3.5 shrink-0" aria-hidden />
          {problem ?? error}
        </p>
      )}

      {pasting ? (
        <div className="space-y-1.5">
          <label htmlFor="dish-image-url" className="block text-xs font-medium text-ink">
            Photo link
          </label>
          <input
            id="dish-image-url"
            value={value}
            placeholder="https://…/paneer-tikka.jpg"
            onChange={(event) => {
              setPreview(null);
              onChange(event.target.value);
            }}
            className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted/70 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10 focus:outline-none"
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setPasting(true)}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 hover:text-brand-600"
        >
          <Link2 className="size-3.5" aria-hidden />
          Or paste a link instead
        </button>
      )}
    </div>
  );
}
