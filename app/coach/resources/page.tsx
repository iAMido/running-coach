'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, Trash2, Plus, CheckCircle, AlertTriangle, FileUp } from 'lucide-react';
import { useState, useEffect, useCallback } from 'react';

interface Resource {
  id: string;
  title: string;
  source_type: string;
  description: string | null;
  methodology_tags: string[] | null;
  chunk_count: number;
  total_tokens: number;
  status: string;
  created_at: string;
}

export default function ResourcesPage() {
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [content, setContent] = useState('');
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const fetchResources = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/coach/resources');
      const data = await r.json();
      setResources(data.resources || []);
    } catch {
      setStatusMessage({ kind: 'err', text: 'Failed to load resources' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchResources();
  }, [fetchResources]);

  const handleSubmitText = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.trim()) return;
    setSubmitting(true);
    setStatusMessage(null);
    try {
      const tagList = tags.split(',').map(t => t.trim()).filter(Boolean);
      const r = await fetch('/api/coach/resources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || undefined,
          methodology_tags: tagList.length ? tagList : undefined,
          content,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      setStatusMessage({
        kind: 'ok',
        text: `Saved "${data.resource.title}" — ${data.resource.chunk_count} chunks, ~${data.resource.total_tokens} tokens.`,
      });
      setTitle('');
      setDescription('');
      setTags('');
      setContent('');
      fetchResources();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setStatusMessage({ kind: 'err', text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitPdf = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !pdfFile) return;
    setSubmitting(true);
    setStatusMessage(null);
    try {
      const fd = new FormData();
      fd.set('title', title.trim());
      if (description.trim()) fd.set('description', description.trim());
      if (tags.trim()) fd.set('methodology_tags', tags.trim());
      fd.set('file', pdfFile);
      const r = await fetch('/api/coach/resources', { method: 'POST', body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Upload failed');
      setStatusMessage({
        kind: 'ok',
        text: `Saved "${data.resource.title}" — ${data.resource.chunk_count} chunks, ~${data.resource.total_tokens} tokens from ${pdfFile.name}.`,
      });
      setTitle('');
      setDescription('');
      setTags('');
      setPdfFile(null);
      fetchResources();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed';
      setStatusMessage({ kind: 'err', text: msg });
    } finally {
      setSubmitting(false);
    }
  };

  const handleArchive = async (id: string) => {
    if (!confirm('Archive this resource? It will stop appearing in the coach\'s context.')) return;
    const r = await fetch(`/api/coach/resources/${id}`, { method: 'DELETE' });
    if (r.ok) fetchResources();
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--rc-ink)' }}>
          <BookOpen className="w-6 h-6" />
          Coach Library
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--rc-ink-3)' }}>
          Add your own coach material — old training plans, physiology notes, articles you trust. The AI coach
          retrieves these alongside the methodology books when answering you.
        </p>
      </div>

      {/* Upload card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="w-5 h-5" />
            Add resource
          </CardTitle>
          <CardDescription>
            Upload a PDF or paste raw text. The coach retrieves chunks of this material whenever it answers you.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="text">
            <TabsList className="mb-3">
              <TabsTrigger value="text">Paste text</TabsTrigger>
              <TabsTrigger value="pdf">Upload PDF</TabsTrigger>
            </TabsList>

            <TabsContent value="text">
              <form onSubmit={handleSubmitText} className="space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium block mb-1">Title *</label>
                    <Input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="e.g. Old coach: Base phase principles"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Methodology tags</label>
                    <Input
                      value={tags}
                      onChange={e => setTags(e.target.value)}
                      placeholder="comma-separated, e.g. lt1,base,marathon"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Description</label>
                  <Input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Short context — who wrote it, why you want the AI to use it"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Content *</label>
                  <Textarea
                    value={content}
                    onChange={e => setContent(e.target.value)}
                    placeholder="Paste the document content here..."
                    rows={12}
                    required
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--rc-ink-4)' }}>
                    {content.length.toLocaleString()} characters
                  </p>
                </div>
                <Button type="submit" disabled={submitting || !title.trim() || !content.trim()}>
                  {submitting ? 'Embedding…' : 'Add to library'}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="pdf">
              <form onSubmit={handleSubmitPdf} className="space-y-3">
                <div className="grid md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium block mb-1">Title *</label>
                    <Input
                      value={title}
                      onChange={e => setTitle(e.target.value)}
                      placeholder="Defaults to filename if blank"
                      required
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium block mb-1">Methodology tags</label>
                    <Input
                      value={tags}
                      onChange={e => setTags(e.target.value)}
                      placeholder="comma-separated"
                    />
                  </div>
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">Description</label>
                  <Input
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Short context"
                  />
                </div>
                <div>
                  <label className="text-sm font-medium block mb-1">PDF file *</label>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    onChange={e => {
                      const f = e.target.files?.[0] || null;
                      setPdfFile(f);
                      if (f && !title.trim()) setTitle(f.name.replace(/\.pdf$/i, ''));
                    }}
                    required
                    className="block w-full text-sm rounded-md border px-3 py-2"
                    style={{ borderColor: 'var(--rc-line)' }}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--rc-ink-4)' }}>
                    Max 15MB. Scanned-image PDFs without an OCR text layer will be rejected.
                  </p>
                </div>
                <Button type="submit" disabled={submitting || !title.trim() || !pdfFile}>
                  <FileUp className="w-4 h-4 mr-1" />
                  {submitting ? 'Parsing & embedding…' : 'Upload PDF'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>

          {statusMessage && (
            <div
              className="mt-3 text-sm flex items-start gap-2 rounded-md px-3 py-2"
              style={{
                background: statusMessage.kind === 'ok' ? 'rgba(16,185,129,0.08)' : 'rgba(220,38,38,0.08)',
                color: statusMessage.kind === 'ok' ? 'rgb(6,95,70)' : 'rgb(127,29,29)',
              }}
            >
              {statusMessage.kind === 'ok' ? (
                <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Library */}
      <Card>
        <CardHeader>
          <CardTitle>Your library ({resources.length})</CardTitle>
          <CardDescription>
            Active resources are searched semantically by the AI on every coach response.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : resources.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--rc-ink-3)' }}>
              No resources yet. Add one above and it&apos;ll be available to the coach on the next chat.
            </p>
          ) : (
            <ul className="space-y-2">
              {resources.map(r => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-3 rounded-md px-3 py-2 border"
                  style={{ borderColor: 'var(--rc-line)' }}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate" style={{ color: 'var(--rc-ink)' }}>
                      {r.title}
                    </div>
                    {r.description && (
                      <div className="text-sm truncate" style={{ color: 'var(--rc-ink-3)' }}>
                        {r.description}
                      </div>
                    )}
                    <div className="text-xs mt-1 rc-mono" style={{ color: 'var(--rc-ink-4)' }}>
                      {r.chunk_count} chunks · ~{r.total_tokens.toLocaleString()} tokens · {r.source_type}
                      {r.methodology_tags?.length ? ' · ' + r.methodology_tags.join(', ') : ''}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleArchive(r.id)}
                    title="Archive"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
