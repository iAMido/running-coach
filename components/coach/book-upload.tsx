'use client';

/**
 * Add a book A to Z. The PDF goes straight from the browser to Storage (books
 * are 6-11 MB; Vercel functions reject bodies over ~4.5 MB), then the server
 * processes it one stage per request — see lib/library/ingest.ts. The page
 * resumes an unfinished upload after a reload.
 */

import { useEffect, useRef, useState } from 'react';
import { BookPlus, CheckCircle2, Circle, Loader2, AlertTriangle } from 'lucide-react';

interface IngestView {
  id: string;
  stage: 'uploaded' | 'extracted' | 'analyzed' | 'chunked' | 'embedded' | 'done' | 'failed';
  label: string;
  busy: boolean;
  filename: string;
  pages: number | null;
  meta: { title: string; author: string; year: number | null; description: string; methodology: string; level: string; tags: string[]; focus_areas: string[]; phases: string[] } | null;
  chunksTotal: number | null;
  chunksDone: number;
  check: { question: string; found: boolean }[] | null;
  error: string | null;
  replacedTitle?: string | null;
}

const STEPS: { stage: IngestView['stage']; title: string }[] = [
  { stage: 'uploaded', title: 'Read the PDF' },
  { stage: 'extracted', title: 'AI reads the book — title, author, description, methodology, tags' },
  { stage: 'analyzed', title: 'Split into chapters and sections' },
  { stage: 'chunked', title: 'Add to the library the coaches search' },
  { stage: 'embedded', title: 'Check the coaches can find it' },
];
const ORDER = ['uploaded', 'extracted', 'analyzed', 'chunked', 'embedded', 'done'];

export function BookUpload({ onAdded, books = [] }: { onAdded: () => void; books?: { id: string; title: string }[] }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [ingest, setIngest] = useState<IngestView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  // An existing book this upload replaces — removed only after the new one is fully in.
  const [replaceId, setReplaceId] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function drive(start: IngestView) {
    let cur = start;
    setIngest(cur);
    while (cur.stage !== 'done' && cur.stage !== 'failed') {
      const res = cur.busy
        ? await new Promise((r) => setTimeout(r, 4000)).then(() => fetch(`/api/coach/library/ingest?id=${cur.id}`))
        : await fetch('/api/coach/library/ingest', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ingestId: cur.id }),
          });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ingest) throw new Error(data.error || `Step failed (${res.status})`);
      cur = data.ingest as IngestView;
      setIngest(cur);
    }
    if (cur.stage === 'done') onAdded();
  }

  // Resume an upload left running by a reload.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/coach/library/ingest');
        if (!res.ok) return;
        const { ingest: open } = await res.json();
        if (!open) return;
        setWorking(true);
        await drive(open);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not resume the upload');
      } finally {
        setWorking(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** PUT with progress — fetch cannot report upload progress. */
  function putWithProgress(url: string, body: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', url);
      xhr.setRequestHeader('Content-Type', body.type || (/\.txt$/i.test(body.name) ? 'text/plain' : 'application/pdf'));
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) setUploadPct(Math.round((100 * e.loaded) / e.total)); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
      xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
      xhr.send(body);
    });
  }

  async function add() {
    if (!file) return;
    setWorking(true);
    setError(null);
    setIngest(null);
    try {
      const u = await fetch('/api/coach/library/upload-url', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, size: file.size }),
      });
      const ud = await u.json().catch(() => ({}));
      if (!u.ok) throw new Error(ud.error || 'Could not prepare the upload');
      setUploadPct(0);
      await putWithProgress(ud.signedUrl, file);
      setUploadPct(null);
      const s = await fetch('/api/coach/library/ingest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: ud.path, filename: file.name, ...(replaceId ? { replaceBookId: replaceId } : {}) }),
      });
      const sd = await s.json().catch(() => ({}));
      if (!s.ok || !sd.ingest) throw new Error(sd.error || 'Could not start processing');
      await drive(sd.ingest as IngestView);
      setFile(null);
      setReplaceId('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploadPct(null);
      setWorking(false);
    }
  }

  const idx = ingest ? ORDER.indexOf(ingest.stage === 'failed' ? 'uploaded' : ingest.stage) : -1;

  return (
    <div className="rc-card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
        <div>
          <div className="rc-kicker mb-1">Upload</div>
          <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>Add a book</h3>
        </div>
        <div className="p-2.5 rounded-xl" style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>
          <BookPlus className="w-4 h-4" />
        </div>
      </div>
      <div className="p-6 space-y-4">
      <p className="text-[13px] leading-relaxed" style={{ color: 'var(--rc-ink-3)' }}>
        Upload a book PDF (up to 50 MB, with selectable text) or a .txt of its text. The app reads it, writes its description,
        methodology and tags, splits it into chapters and sections, and adds it to the library the coaches search — then checks
        they can find it. To swap a book for a better version, choose it under &ldquo;Replaces&rdquo;.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        {/* The native file input is hidden; the label is the styled button. */}
        <input ref={inputRef} id="book-pdf" type="file" accept="application/pdf,.pdf,text/plain,.txt" disabled={working}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="sr-only" />
        <label htmlFor="book-pdf"
          className={`px-4 py-2 rounded-xl text-[13px] font-medium ${working ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}
          style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink-2)' }}>
          Choose PDF
        </label>
        <span className="text-[13px] truncate max-w-[16rem]" style={{ color: file ? 'var(--rc-ink)' : 'var(--rc-ink-4)' }}>
          {file ? file.name : 'No file chosen'}
        </span>
        <button type="button" onClick={add} disabled={!file || working}
          className="px-4 py-2 rounded-xl text-[13px] font-medium disabled:opacity-40" style={{ background: 'var(--rc-blue)', color: 'white' }}>
          {working ? 'Working…' : 'Add book'}
        </button>
        {file && !working && <span className="rc-mono text-[11px]" style={{ color: 'var(--rc-ink-4)' }}>{(file.size / 1e6).toFixed(1)} MB</span>}
      </div>

      {books.length > 0 && (
        <label className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: 'var(--rc-ink-2)' }}>
          Replaces
          <select value={replaceId} onChange={(e) => setReplaceId(e.target.value)} disabled={working}
            className="px-3 py-2 rounded-xl text-[13px] max-w-full" style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink)' }}>
            <option value="">Nothing — this is a new book</option>
            {books.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
          </select>
        </label>
      )}

      {uploadPct !== null && (
        <div>
          <div className="text-[12px] mb-1" style={{ color: 'var(--rc-ink-3)' }}>Uploading… {uploadPct}%</div>
          <div className="h-1.5 rounded-full" style={{ background: 'var(--rc-surface-2)' }}>
            <div className="h-1.5 rounded-full transition-all" style={{ width: `${uploadPct}%`, background: 'var(--rc-blue)' }} />
          </div>
        </div>
      )}

      {ingest && (
        <ol className="space-y-2">
          {STEPS.map((s, i) => {
            const state = ingest.stage === 'done' || i < idx ? 'done' : i === idx ? (ingest.stage === 'failed' ? 'failed' : 'active') : 'pending';
            return (
              <li key={s.stage} className="flex gap-2 text-[13px]" style={{ color: state === 'pending' ? 'var(--rc-ink-4)' : 'var(--rc-ink)' }}>
                {state === 'done' && <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'oklch(0.55 0.13 150)' }} />}
                {state === 'active' && <Loader2 className="w-4 h-4 mt-0.5 shrink-0 animate-spin" style={{ color: 'var(--rc-blue)' }} />}
                {state === 'failed' && <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'oklch(0.55 0.18 25)' }} />}
                {state === 'pending' && <Circle className="w-4 h-4 mt-0.5 shrink-0" style={{ color: 'var(--rc-ink-4)' }} />}
                <span>
                  {s.title}
                  {s.stage === 'uploaded' && ingest.pages ? <span style={{ color: 'var(--rc-ink-3)' }}> — {ingest.pages} pages</span> : null}
                  {s.stage === 'chunked' && ingest.chunksTotal ? <span style={{ color: 'var(--rc-ink-3)' }}> — {ingest.chunksDone}/{ingest.chunksTotal} sections</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {ingest?.stage === 'done' && ingest.meta && (
        <div className="rounded-xl p-4 space-y-2 text-[13px]" style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink-2)' }}>
          <div className="font-semibold" style={{ color: 'var(--rc-ink)' }}>{ingest.meta.title}</div>
          {ingest.replacedTitle && <div className="text-[12px]" style={{ color: 'oklch(0.50 0.13 150)' }}>Replaced &ldquo;{ingest.replacedTitle}&rdquo;.</div>}
          <div style={{ color: 'var(--rc-ink-3)' }}>{ingest.meta.author}{ingest.meta.year ? ` · ${ingest.meta.year}` : ''} · methodology “{ingest.meta.methodology}” · {ingest.meta.level}</div>
          <p>{ingest.meta.description}</p>
          <div className="flex flex-wrap gap-1.5">{ingest.meta.tags.map((t) => <span key={t} className="rc-mono text-[10.5px] px-2 py-0.5 rounded-md" style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)' }}>{t}</span>)}</div>
          {ingest.check && (
            <ul className="space-y-0.5 text-[12px]" style={{ color: 'var(--rc-ink-3)' }}>
              {ingest.check.map((c) => <li key={c.question}>{c.found ? '✓' : '·'} “{c.question}” {c.found ? 'finds this book' : 'is answered from other books first'}</li>)}
            </ul>
          )}
        </div>
      )}

      {(error || ingest?.stage === 'failed') && (
        <p className="text-[12.5px]" style={{ color: 'oklch(0.50 0.18 25)' }}>
          {error ?? ingest?.error} Nothing was added to the library.
        </p>
      )}
      </div>
    </div>
  );
}
