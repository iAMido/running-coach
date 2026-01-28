'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { MessageSquare, Send, Trash2, User, Bot, Wand2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { ChatMessage, TrainingPlan } from '@/lib/db/types';

export default function AskCoachPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Plan adjustment state
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
  }, []);

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
        body: JSON.stringify({ messages: updatedMessages }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to get response');
      }

      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: data.content,
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

  // Extract the last user message as the adjustment request
  const getConversationContext = (): string => {
    const userMessages = messages.filter(m => m.role === 'user');
    if (userMessages.length === 0) return '';
    // Get last few messages for context
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

      // Refresh the plan data
      if (data.planUpdated) {
        fetchActivePlan();
        // Add a system message about the adjustment
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
          <h1 className="coach-heading text-3xl tracking-tight">Ask Coach</h1>
          <p className="text-muted-foreground mt-2">
            Chat with your AI running coach powered by Claude.
          </p>
        </div>
        {messages.length > 0 && (
          <Button variant="outline" size="sm" onClick={handleClear} className="coach-button-focus">
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Chat
          </Button>
        )}
      </div>

      {/* Plan Adjustment Panel - Show when there's an active plan and messages */}
      {activePlan && messages.length > 0 && (
        <Card className={`coach-card border-2 transition-all ${showAdjustPanel ? 'border-blue-500/50' : 'border-dashed border-primary/30'}`}>
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg bg-gradient-to-br from-blue-500/15 to-cyan-500/15 ${adjusting ? 'animate-pulse' : ''}`}>
                  <Wand2 className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className="font-medium text-sm">Want to adjust your plan?</p>
                  <p className="text-xs text-muted-foreground">
                    <Badge variant="outline" className="mr-2">
                      Week {activePlan.current_week_num} of {activePlan.duration_weeks}
                    </Badge>
                    AI can modify your training based on this conversation
                  </p>
                </div>
              </div>
              <Button
                onClick={handleAdjustPlan}
                disabled={adjusting}
                size="sm"
                className="bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white shrink-0"
              >
                <Wand2 className="w-4 h-4 mr-2" />
                {adjusting ? 'Adjusting...' : 'Adjust Plan'}
              </Button>
            </div>

            {/* Adjustment Error */}
            {adjustmentError && (
              <div className="mt-3 p-3 rounded-lg bg-red-500/10 text-red-500 text-sm border border-red-500/20">
                {adjustmentError}
              </div>
            )}

            {/* Adjustment Result */}
            {adjustmentResult && (
              <div className="mt-3 space-y-3 p-3 bg-gradient-to-br from-blue-500/5 to-cyan-500/5 rounded-lg border border-blue-500/20">
                {adjustmentResult.planUpdated && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="w-4 h-4" />
                    <span className="font-semibold text-sm">Plan Updated!</span>
                  </div>
                )}

                {adjustmentResult.warnings && adjustmentResult.warnings.length > 0 && (
                  <div className="flex items-start gap-2 text-amber-600">
                    <AlertTriangle className="w-4 h-4 mt-0.5" />
                    <ul className="text-xs space-y-1">
                      {adjustmentResult.warnings.map((warn, i) => (
                        <li key={i}>{warn}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Chat Container */}
      <Card className="coach-card flex-1 flex flex-col overflow-hidden">
        <CardHeader className="border-b border-border/50">
          <CardTitle className="coach-heading flex items-center gap-2 text-lg">
            <div className={`ai-icon-container w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center ${loading ? 'active ai-pulse' : ''}`}>
              <Bot className="w-5 h-5 text-white" />
            </div>
            AI Running Coach
          </CardTitle>
          <CardDescription>
            Ask about your training, plan adjustments, pace recommendations, and more.
          </CardDescription>
        </CardHeader>

        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <MessageSquare className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>Start a conversation with your coach.</p>
                <p className="text-sm mt-2">Try asking:</p>
                <div className="mt-4 space-y-2">
                  {[
                    'How should I adjust my easy run pace?',
                    'I have a busy week - can you reduce my training?',
                    'My knee is bothering me, what should I do?',
                    'Can I swap Monday\'s run to Tuesday?',
                  ].map((example) => (
                    <button
                      key={example}
                      onClick={() => setInput(example)}
                      className="block w-full text-sm px-4 py-2 rounded-lg bg-muted hover:bg-muted/80 transition-colors text-left"
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
                  className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'
                    }`}
                >
                  {message.role === 'assistant' && (
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center shrink-0">
                      <Bot className="w-4 h-4 text-white" />
                    </div>
                  )}
                  <div
                    className={`max-w-[80%] rounded-2xl px-4 py-3 ${message.role === 'user'
                      ? 'bg-blue-500 text-white'
                      : 'bg-muted'
                      }`}
                  >
                    <p className="text-sm whitespace-pre-wrap">{message.content}</p>
                  </div>
                  {message.role === 'user' && (
                    <div className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex gap-3 justify-start">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-green-500 flex items-center justify-center shrink-0">
                    <Bot className="w-4 h-4 text-white" />
                  </div>
                  <div className="bg-muted rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '0ms' }} />
                      <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '150ms' }} />
                      <span className="w-2 h-2 rounded-full bg-muted-foreground animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </>
          )}
        </CardContent>

        {/* Input Area */}
        <div className="border-t border-border/50 p-4">
          <div className="flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your coach..."
              rows={1}
              className="resize-none coach-input-focus"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="btn-gradient-primary shrink-0 coach-button-accessible"
              aria-label="Send message"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
