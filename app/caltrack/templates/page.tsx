'use client';

import { useEffect, useState, useCallback } from 'react';
import { Bookmark, Pencil, Trash2, ChevronDown, ChevronUp, Check, X } from 'lucide-react';
import type { MealTemplate, MealTemplateItem } from '@/lib/db/caltrack-types';

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<MealTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/caltrack/templates');
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const startRename = (tmpl: MealTemplate) => {
    setEditingId(tmpl.id);
    setEditName(tmpl.name);
  };

  const cancelRename = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveRename = async (id: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/caltrack/templates', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, name: editName.trim() }),
      });
      if (res.ok) {
        setTemplates((prev) =>
          prev.map((t) => (t.id === id ? { ...t, name: editName.trim() } : t))
        );
        cancelRename();
      }
    } finally {
      setSaving(false);
    }
  };

  const deleteTemplate = async (tmpl: MealTemplate) => {
    if (!confirm(`Delete "${tmpl.name}"? This cannot be undone.`)) return;
    const res = await fetch(`/api/caltrack/templates?id=${tmpl.id}`, {
      method: 'DELETE',
    });
    if (res.ok) {
      setTemplates((prev) => prev.filter((t) => t.id !== tmpl.id));
    }
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="pb-5 mb-2" style={{ borderBottom: '1px solid var(--ct-line)' }}>
        <div className="ct-kicker flex items-center gap-2.5 mb-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--ct-ember)' }} />
          Saved meals
        </div>
        <h1
          className="text-[40px] font-bold leading-none m-0"
          style={{ letterSpacing: '-0.025em', color: 'var(--ct-ink)' }}
        >
          Templates
        </h1>
        <p className="mt-2.5 text-sm max-w-[620px]" style={{ color: 'var(--ct-ink-3)' }}>
          One-tap re-log from Telegram with{' '}
          <span className="ct-mono text-[11.5px] text-white px-1.5 py-0.5 rounded" style={{ background: 'var(--ct-ink)' }}>
            /t {'<name>'}
          </span>{' '}
          or from the meals page. Rename or delete here.
        </p>
      </div>

      {loading ? (
        <div className="ct-card p-8 text-center" style={{ color: 'var(--ct-ink-3)' }}>
          Loading…
        </div>
      ) : templates.length === 0 ? (
        <div className="ct-card p-12 text-center space-y-3">
          <Bookmark className="w-12 h-12 mx-auto" style={{ color: 'var(--ct-ink-4)' }} />
          <p className="text-base font-medium" style={{ color: 'var(--ct-ink-2)' }}>
            No templates saved yet
          </p>
          <p className="text-sm" style={{ color: 'var(--ct-ink-4)' }}>
            From any meal in the dashboard, open it and tap &quot;Save as template&quot;.
          </p>
        </div>
      ) : (
        <div className="ct-card divide-y" style={{ borderColor: 'var(--ct-line)' }}>
          {templates.map((tmpl) => {
            const isExpanded = expandedId === tmpl.id;
            const isEditing = editingId === tmpl.id;
            return (
              <div key={tmpl.id} className="p-5" style={{ borderColor: 'var(--ct-line)' }}>
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveRename(tmpl.id);
                            if (e.key === 'Escape') cancelRename();
                          }}
                          autoFocus
                          className="flex-1 px-3 py-2 rounded-xl text-base focus:outline-none focus:ring-2"
                          style={{
                            background: 'var(--ct-surface-2)',
                            border: '1px solid var(--ct-line)',
                            color: 'var(--ct-ink)',
                          }}
                        />
                        <button
                          onClick={() => saveRename(tmpl.id)}
                          disabled={saving || !editName.trim()}
                          className="p-2 rounded-lg text-white disabled:opacity-50"
                          style={{ background: 'var(--ct-good)' }}
                          title="Save"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={cancelRename}
                          className="p-2 rounded-lg"
                          style={{ color: 'var(--ct-ink-3)' }}
                          title="Cancel"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <h3
                          className="text-[17px] font-semibold m-0"
                          style={{ color: 'var(--ct-ink)', letterSpacing: '-0.01em' }}
                        >
                          {tmpl.name}
                        </h3>
                        <div className="ct-mono text-xs mt-1.5" style={{ color: 'var(--ct-ink-3)' }}>
                          {tmpl.total_calories || 0} kcal &middot;{' '}
                          P {Math.round(tmpl.total_protein_g || 0)}g &middot;{' '}
                          C {Math.round(tmpl.total_carbs_g || 0)}g &middot;{' '}
                          F {Math.round(tmpl.total_fat_g || 0)}g &middot;{' '}
                          {tmpl.items.length} item{tmpl.items.length === 1 ? '' : 's'}
                        </div>
                      </>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : tmpl.id)}
                        className="p-2 rounded-lg transition-colors hover:opacity-70"
                        style={{
                          color: 'var(--ct-ink-3)',
                          background: 'var(--ct-surface-2)',
                          border: '1px solid var(--ct-line)',
                        }}
                        title={isExpanded ? 'Collapse' : 'Show items'}
                      >
                        {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <button
                        onClick={() => startRename(tmpl)}
                        className="p-2 rounded-lg transition-colors hover:opacity-70"
                        style={{
                          color: 'var(--ct-ink-3)',
                          background: 'var(--ct-surface-2)',
                          border: '1px solid var(--ct-line)',
                        }}
                        title="Rename"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => deleteTemplate(tmpl)}
                        className="p-2 rounded-lg transition-colors hover:opacity-70"
                        style={{
                          color: 'var(--ct-bad)',
                          background: 'rgba(239,83,80,0.05)',
                          border: '1px solid rgba(239,83,80,0.2)',
                        }}
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div
                    className="mt-4 pt-3 space-y-2"
                    style={{ borderTop: '1px solid var(--ct-line)' }}
                  >
                    {tmpl.items.length === 0 ? (
                      <p className="text-sm" style={{ color: 'var(--ct-ink-4)' }}>
                        No items in this template.
                      </p>
                    ) : (
                      tmpl.items.map((item: MealTemplateItem) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between py-2 text-sm"
                          style={{ borderBottom: '1px solid var(--ct-line)' }}
                        >
                          <div>
                            <span className="font-medium" style={{ color: 'var(--ct-ink)' }}>
                              {item.ingredient_name}
                            </span>
                            <span className="ct-mono text-xs ml-2" style={{ color: 'var(--ct-ink-4)' }}>
                              {item.weight_grams}g
                            </span>
                          </div>
                          <span className="ct-mono text-xs font-medium" style={{ color: 'var(--ct-ink-3)' }}>
                            {item.calories} kcal &middot; P {item.protein_g}g
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
