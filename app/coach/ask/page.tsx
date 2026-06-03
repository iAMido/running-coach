'use client';

import { MessageSquare, Send, Trash2, User, Bot, Wand2, CheckCircle2, AlertTriangle, ShieldAlert, History, Plus } from 'lucide-react';
import { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatMessage, TrainingPlan } from '@/lib/db/types';

interface ChatSession {
  id: string;
  title: string | null;
  message_count: number;
  created_at: string;
  updated_at: string;
}

interface SupervisorWarning {
  code: string;
  message: string;
  severity: 'warn' | 'block';
}
type DisplayMessage = ChatMessage & { supervisor?: { warnings: SupervisorWarning[] } };

export default function AskCoachPage() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [activePlan, setActivePlan] = useState<TrainingPlan | null>(null);
  const [showAdjustPanel, setShowAdjustPanel] = useState(false);
  const [adjusting, setAdjusting] = useState(false);
  const [adjustmentResult, setAdjustmentResult] = useState<{
    summary?: string;
    recommendations?: string[];
    warnings?: string[];
    planUpdated?: boolean;
  } | null>(null);
  const [adjustmentError, setAdjustmentError] = useState<string | null>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    fetchActivePlan();
    fetchSessions();
  }, []);

  const fetchSessions = useCallback(async () => {
    try {
      const r = await fetch('/api/coach/chat/sessions');
      if (r.ok) {
        const data = await r.json();
        setSessions(data.sessions || []);
      }
    } catch {}
  }, []);

  const loadSession = useCallback(async (id: string) => {
    try {
      const r = await fetch(`/api/coach/chat/sessions/${id}`);
      if (!r.ok) return;
      const data = await r.json();
      const msgs: DisplayMessage[] = (data.messages || []).map((m: { role: string; content: string; supervisor?: { warnings?: SupervisorWarning[] } }) => ({
        role: m.role as ChatMessage['role'],
        content: m.content,
        supervisor: m.supervisor && m.supervisor.warnings ? { warnings: m.supervisor.warnings } : undefined,
      }));
      setSessionId(id);
      setMessages(msgs);
      setHistoryOpen(false);
    } catch {}
  }, []);

  const newSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setAdjustmentResult(null);
    setShowAdjustPanel(false);
    setHistoryOpen(false);
  }, []);

  const archiveSession = useCallback(async (id: string) => {
    if (!confirm('Archive this conversation?')) return;
    await fetch(`/api/coach/chat/sessions/${id}`, { method: 'DELETE' });
    if (id === sessionId) newSession();
    fetchSessions();
  }, [fetchSessions, newSession, sessionId]);

  const fetchActivePlan = async () => {
    try {
      const response = await fetch('/api/coach/plans');
      if (response.ok) {
        const data = await response.json();
        setActivePlan(data.plan || null);
      }
    } catch (err) {
      console.error('Failed to fetch plan:', err);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: input };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/coach/chat/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages, sessionId }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response');
      }

      // Capture the server-issued sessionId so subsequent turns target the
      // same conversation, and refresh the list so the sidebar reflects
      // the new session.
      if (data.sessionId && data.sessionId !== sessionId) {
        setSessionId(data.sessionId);
        fetchSessions();
      } else if (data.sessionId) {
        // existing session — bump its position in the list
        fetchSessions();
      }

      const assistantMessage: DisplayMessage = {
        role: 'assistant',
        content: data.content,
        supervisor: data.supervisor ? { warnings: data.supervisor.warnings || [] } : undefined,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Failed to get response:', error);
      const errorMessage: ChatMessage = {
        role: 'assistant',
        content: `Sorry, I encountered an error: ${error instanceof Error ? error.message : 'Unknown error'}. Please try again.`,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setMessages([]);
    setAdjustmentResult(null);
    setShowAdjustPanel(false);
  };

  const getConversationContext = (): string => {
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return '';
    const recentMessages = messages.slice(-4);
    return recentMessages.map(m => `${m.role}: ${m.content}`).join('\n');
  };

  const handleAdjustPlan = async () => {
    if (!activePlan) return;

    setAdjusting(true);
    setAdjustmentError(null);
    setAdjustmentResult(null);

    try {
      const conversationContext = getConversationContext();
      const response = await fetch('/api/coach/plans/adjust', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustmentType: 'user_request',
          userRequest: conversationContext || 'Adjust my plan based on our conversation',
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to adjust plan');
      }

      setAdjustmentResult({
        summary: data.adjustment?.adjustment_summary,
        recommendations: data.adjustment?.recommendations,
        warnings: data.adjustment?.warnings,
        planUpdated: data.planUpdated,
      });

      if (data.planUpdated) {
        fetchActivePlan();
        const adjustmentMessage: ChatMessage = {
          role: 'assistant',
          content: `✅ I've updated your training plan!\n\n**Summary:** ${data.adjustment?.adjustment_summary || 'Plan adjusted based on our discussion.'}\n\n${data.adjustment?.recommendations ? `**Changes:**\n${data.adjustment.recommendations.map((r: string) => `• ${r}`).join('\n')}` : ''}`,
        };
        setMessages(prev => [...prev, adjustmentMessage]);
      }
    } catch (err) {
      setAdjustmentError(err instanceof Error ? err.message : 'Failed to adjust plan');
    } finally {
      setAdjusting(false);
    }
  };

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="rc-kicker flex items-center gap-2.5 mb-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: 'var(--rc-blue)' }} />
            ASK COACH
          </div>
          <h1
            className="text-[36px] font-bold leading-[1.05]"
            style={{ letterSpacing: '-0.03em', color: 'var(--rc-ink)' }}
          >
            Chat with{' '}
            <span className="font-normal italic" style={{ fontFamily: 'var(--font-serif, Georgia, serif)', color: 'var(--rc-ink-2)' }}>
              your coach.
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-2 relative">
          <button
            onClick={newSession}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium transition-colors"
            style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink-3)' }}
          >
            <Plus className="w-3.5 h-3.5" />
            New chat
          </button>
          <button
            onClick={() => setHistoryOpen(v => !v)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium transition-colors"
            style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink-3)' }}
          >
            <History className="w-3.5 h-3.5" />
            History ({sessions.length})
          </button>
          {messages.length > 0 && (
            <button
              onClick={handleClear}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-medium transition-colors"
              style={{ background: 'var(--rc-surface)', border: '1px solid var(--rc-line)', color: 'var(--rc-ink-3)' }}
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}

          {historyOpen && (
            <div
              className="absolute right-0 top-full mt-2 w-[320px] max-h-[400px] overflow-y-auto rounded-xl shadow-lg z-30"
              style={{ background: 'var(--rc-paper)', border: '1px solid var(--rc-line)' }}
            >
              <div className="p-2 border-b" style={{ borderColor: 'var(--rc-line)' }}>
                <div className="rc-kicker px-2 py-1">Past conversations</div>
              </div>
              {sessions.length === 0 ? (
                <div className="p-4 text-sm text-center" style={{ color: 'var(--rc-ink-4)' }}>No saved chats yet.</div>
              ) : (
                <ul>
                  {sessions.map(s => (
                    <li
                      key={s.id}
                      className="flex items-start justify-between gap-2 px-3 py-2 hover:bg-[var(--rc-surface-2)] cursor-pointer"
                      style={{ borderBottom: '1px solid var(--rc-line)' }}
                    >
                      <button onClick={() => loadSession(s.id)} className="flex-1 text-left min-w-0">
                        <div className="text-sm truncate" style={{ color: s.id === sessionId ? 'var(--rc-blue)' : 'var(--rc-ink)' }}>
                          {s.title || 'Untitled'}
                        </div>
                        <div className="rc-mono text-[10px] mt-0.5" style={{ color: 'var(--rc-ink-4)', letterSpacing: '0.06em' }}>
                          {s.message_count} msgs · {new Date(s.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </div>
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); archiveSession(s.id); }}
                        className="opacity-50 hover:opacity-100"
                        title="Archive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Plan Adjustment Panel */}
      {activePlan && messages.length > 0 && (
        <div className="rc-card relative overflow-hidden p-4">
          <span className="absolute left-0 top-0 bottom-0 w-[3px] rounded-r-[3px]" style={{ background: 'var(--rc-amber)' }} />
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-xl ${adjusting ? 'animate-pulse' : ''}`} style={{ background: 'oklch(0.96 0.05 75)', color: 'oklch(0.50 0.13 75)' }}>
                <Wand2 className="w-4 h-4" />
              </div>
              <div>
                <p className="font-medium text-sm" style={{ color: 'var(--rc-ink)' }}>Want to adjust your plan?</p>
                <p className="text-xs" style={{ color: 'var(--rc-ink-3)' }}>
                  <span
                    className="rc-mono text-[10px] px-2 py-0.5 rounded-[5px] mr-2"
                    style={{ background: 'oklch(0.96 0.05 75)', color: 'oklch(0.50 0.13 75)', letterSpacing: '0.06em' }}
                  >
                    WK {activePlan.current_week_num}/{activePlan.duration_weeks}
                  </span>
                  AI can modify based on this conversation
                </p>
              </div>
            </div>
            <button
              onClick={handleAdjustPlan}
              disabled={adjusting}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full text-xs font-semibold shrink-0 transition-colors disabled:opacity-50"
              style={{ background: 'var(--rc-amber)', color: '#fff' }}
            >
              <Wand2 className="w-3.5 h-3.5" />
              {adjusting ? 'Adjusting...' : 'Adjust Plan'}
            </button>
          </div>

          {adjustmentError && (
            <div className="mt-3 p-3 rounded-xl text-sm" style={{ background: 'oklch(0.95 0.05 25)', color: 'var(--rc-bad)' }}>
              {adjustmentError}
            </div>
          )}

          {adjustmentResult && (
            <div className="mt-3 space-y-2 p-3 rounded-xl" style={{ background: 'oklch(0.96 0.05 75)', border: '1px solid oklch(0.90 0.08 75)' }}>
              {adjustmentResult.planUpdated && (
                <div className="flex items-center gap-2" style={{ color: 'var(--rc-good)' }}>
                  <CheckCircle2 className="w-4 h-4" />
                  <span className="font-semibold text-sm">Plan Updated!</span>
                </div>
              )}
              {adjustmentResult.warnings && adjustmentResult.warnings.length > 0 && (
                <div className="flex items-start gap-2" style={{ color: 'var(--rc-amber)' }}>
                  <AlertTriangle className="w-4 h-4 mt-0.5" />
                  <ul className="text-xs space-y-0.5">
                    {adjustmentResult.warnings.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat Container */}
      <div className="rc-card p-0 overflow-hidden flex-1 flex flex-col">
        {/* Chat Header */}
        <div className="flex items-center gap-3 px-6 py-4" style={{ background: 'var(--rc-surface-2)', borderBottom: '1px solid var(--rc-line)' }}>
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center ${loading ? 'animate-pulse' : ''}`}
            style={{ background: 'linear-gradient(135deg, var(--rc-blue), var(--rc-good))' }}
          >
            <Bot className="w-5 h-5 text-white" />
          </div>
          <div>
            <h3 className="text-[15px] font-bold" style={{ letterSpacing: '-0.01em', color: 'var(--rc-ink)' }}>AI Running Coach</h3>
            <p className="text-xs" style={{ color: 'var(--rc-ink-4)' }}>Ask about training, pace, recovery, and more.</p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center" style={{ color: 'var(--rc-ink-3)' }}>
                <MessageSquare className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--rc-ink-4)' }} />
                <p className="font-medium text-sm">Start a conversation with your coach.</p>
                <p className="text-xs mt-1" style={{ color: 'var(--rc-ink-4)' }}>Try asking:</p>
                <div className="mt-4 space-y-2 max-w-md mx-auto">
                  {[
                    'How should I adjust my easy run pace?',
                    'I have a busy week - can you reduce my training?',
                    'My knee is bothering me, what should I do?',
                    'Can I swap Monday\'s run to Tuesday?',
                  ].map((example) => (
                    <button
                      key={example}
                      onClick={() => setInput(example)}
                      className="block w-full text-sm text-left px-4 py-2.5 rounded-xl transition-colors"
                      style={{
                        background: 'var(--rc-surface-2)',
                        border: '1px solid var(--rc-line)',
                        color: 'var(--rc-ink-2)',
                      }}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              {messages.map((message, index) => (
                <div
                  key={index}
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {message.role === 'assistant' && (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'linear-gradient(135deg, var(--rc-blue), var(--rc-good))' }}
                    >
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div className="max-w-[80%] flex flex-col gap-1.5">
                    {message.role === 'assistant' && message.supervisor && message.supervisor.warnings.length > 0 && (
                      <div
                        className="flex flex-wrap items-center gap-1.5 text-[11px] rounded-lg px-2.5 py-1.5"
                        style={{
                          background: 'oklch(0.96 0.05 75)',
                          border: '1px solid oklch(0.90 0.08 75)',
                          color: 'oklch(0.40 0.10 75)',
                        }}
                        title={message.supervisor.warnings.map(w => `${w.code}: ${w.message}`).join('\n')}
                      >
                        <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                        <span className="font-medium">Coach context note{message.supervisor.warnings.length > 1 ? 's' : ''}:</span>
                        {message.supervisor.warnings.map(w => (
                          <span
                            key={w.code}
                            className="rc-mono"
                            style={{ padding: '1px 6px', borderRadius: 4, background: 'rgba(0,0,0,0.04)' }}
                          >
                            {w.code}
                          </span>
                        ))}
                      </div>
                    )}
                    <div
                      className="rounded-2xl px-4 py-3"
                      style={{
                        background: message.role === 'user' ? 'var(--rc-blue)' : 'var(--rc-surface-2)',
                        color: message.role === 'user' ? '#fff' : 'var(--rc-ink)',
                      }}
                    >
                      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                    </div>
                  </div>
                  {message.role === 'user' && (
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                      style={{ background: 'var(--rc-surface-2)', color: 'var(--rc-ink-3)' }}
                    >
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex gap-3 justify-start">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: 'linear-gradient(135deg, var(--rc-blue), var(--rc-good))' }}
                  >
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="rounded-2xl px-4 py-3" style={{ background: 'var(--rc-surface-2)' }}>
                    <div className="flex gap-1">
                      <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--rc-ink-4)', animationDelay: '0ms' }} />
                      <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--rc-ink-4)', animationDelay: '150ms' }} />
                      <span className="w-2 h-2 rounded-full animate-bounce" style={{ background: 'var(--rc-ink-4)', animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4" style={{ borderTop: '1px solid var(--rc-line)' }}>
          <div className="flex gap-2">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your coach..."
              rows={1}
              className="flex-1 px-4 py-2.5 rounded-xl text-sm resize-none focus:outline-none focus:ring-2"
              style={{
                background: 'var(--rc-surface-2)',
                border: '1px solid var(--rc-line)',
                color: 'var(--rc-ink)',
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="w-10 h-10 rounded-full grid place-items-center shrink-0 transition-colors disabled:opacity-40"
              style={{ background: 'var(--rc-blue)', color: '#fff' }}
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
