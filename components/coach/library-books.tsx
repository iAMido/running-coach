'use client';

/**
 * Every methodology book the coaches search (coaching_books), with its
 * sections, methodology, level, tags and description.
 */

import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronUp } from 'lucide-react';

export interface LibraryBook {
  id: string;
  title: string;
  author: string;
  methodology: string;
  level: string | null;
  tags: string[];
  phases: string[];
  focusAreas: string[];
  description: string | null;
  uploaded: boolean;
  sections: number;
  addedAt: string;
}

export function LibraryBooks({ books, loading }: { books: LibraryBook[]; loading: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  const muted = { color: 'var(--rc-ink-3)' };
  return (
    <div className="rc-card p-0 overflow-hidden">
      <div className="flex items-center justify-between px-6 pt-5 pb-3.5" style={{ borderBottom: '1px solid var(--rc-line)' }}>
        <div>
          <div className="rc-kicker mb-1">Library</div>
          <h3 className="text-[18px] font-bold" style={{ letterSpacing: '-0.015em', color: 'var(--rc-ink)' }}>Books the coaches read ({books.length})</h3>
        </div>
        <div className="p-2.5 rounded-xl" style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>
          <BookOpen className="w-4 h-4" />
        </div>
      </div>
      <div className="p-6 space-y-3">
      <p className="text-[13px]" style={muted}>
        Every book below is searched when the coaches build plans, review your weeks and answer you.
        {books.length > 0 && ` ${books.reduce((a, b) => a + b.sections, 0).toLocaleString()} sections in total.`}
      </p>
      {loading ? (
        <p className="text-[13px]" style={muted}>Loading…</p>
      ) : (
        <div className="space-y-2">
          {books.map((b) => {
            const isOpen = open === b.id;
            return (
              <div key={b.id} className="rounded-xl" style={{ background: 'var(--rc-surface-2)', border: '1px solid var(--rc-line)' }}>
                <button type="button" onClick={() => setOpen(isOpen ? null : b.id)} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold truncate" style={{ color: 'var(--rc-ink)' }}>{b.title}</div>
                    <div className="text-[12px] truncate" style={muted}>
                      {b.author || 'Unknown author'} · <span style={{ color: 'var(--rc-ink-2)' }}>{b.methodology}</span>
                      {b.level ? ` · ${b.level}` : ''} · {b.sections} sections
                      {b.uploaded && <span className="rc-mono text-[10px] ml-2 px-1.5 py-0.5 rounded" style={{ background: 'var(--rc-blue-soft)', color: 'var(--rc-blue-deep)' }}>UPLOADED</span>}
                    </div>
                  </div>
                  {isOpen ? <ChevronUp className="w-4 h-4 shrink-0" style={{ color: 'var(--rc-ink-4)' }} /> : <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--rc-ink-4)' }} />}
                </button>
                {isOpen && (
                  <div className="px-4 pb-4 space-y-2 text-[12.5px]" style={{ color: 'var(--rc-ink-2)' }}>
                    {b.description && <p>{b.description}</p>}
                    {b.focusAreas.length > 0 && <p><strong>Covers:</strong> {b.focusAreas.join('; ')}</p>}
                    {b.phases.length > 0 && <p><strong>Phases:</strong> {b.phases.join(' → ')}</p>}
                    {b.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {b.tags.map((t) => <span key={t} className="rc-mono text-[10.5px] px-2 py-0.5 rounded-md" style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)' }}>{t}</span>)}
                      </div>
                    )}
                    <p className="rc-mono text-[10.5px]" style={{ color: 'var(--rc-ink-4)' }}>Added {new Date(b.addedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>
    </div>
  );
}
