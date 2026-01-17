'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Dumbbell, Send, Trash2, User, Bot, FileSearch } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import type { ChatMessage } from '@/lib/db/types';

export default function GrockyBalboaPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [planReview, setPlanReview] = useState<string | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage: ChatMessage = { role: 'user', content: input };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput('');
    setLoading(true);

    try {
      const response = await fetch('/api/coach/chat/grocky', {
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
        content: `Yo, hit a snag there: ${error instanceof Error ? error.message : 'Unknown error'}. Give it another shot! 🥊`,
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handlePlanReview = async () => {
    setReviewLoading(true);
    try {
      const response = await fetch('/api/coach/chat/grocky', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewPlan: true }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to review plan');
      }

      setPlanReview(data.content);
    } catch (error) {
      console.error('Failed to review plan:', error);
      setPlanReview(`Couldn't get the review done: ${error instanceof Error ? error.message : 'Unknown error'}. Try again! 🥊`);
    } finally {
      setReviewLoading(false);
    }
  };

  const handleClearChat = () => {
    setMessages([]);
  };

  const handleClearReview = () => {
    setPlanReview(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="coach-heading text-3xl tracking-tight flex items-center gap-3">
          <span className="text-4xl">🥊</span>
          Grocky Balboa
        </h1>
        <p className="text-muted-foreground mt-2">
          Your analytical second opinion, powered by Grok. No punches pulled.
        </p>
      </div>

      <Tabs defaultValue="chat" className="space-y-6">
        <TabsList>
          <TabsTrigger value="chat">Chat with Grocky</TabsTrigger>
          <TabsTrigger value="review">Plan Review</TabsTrigger>
        </TabsList>

        {/* Chat Tab */}
        <TabsContent value="chat" className="h-[calc(100vh-16rem)]">
          <Card className="coach-card h-full flex flex-col">
            <CardHeader className="border-b border-border/50 flex flex-row items-center justify-between">
              <div>
                <CardTitle className="coach-heading flex items-center gap-2 text-lg">
                  <div className={`ai-icon-container w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center ${loading ? 'active ai-pulse' : ''}`}>
                    <Dumbbell className="w-5 h-5 text-white" />
                  </div>
                  Grocky Balboa
                </CardTitle>
                <CardDescription>
                  Training science, no BS. Ask about alternative approaches.
                </CardDescription>
              </div>
              {messages.length > 0 && (
                <Button variant="outline" size="sm" onClick={handleClearChat} className="coach-button-focus">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear
                </Button>
              )}
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center">
                  <div className="text-center text-muted-foreground">
                    <Dumbbell className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>Ready to give you the straight talk.</p>
                    <p className="text-sm mt-2">Ask about:</p>
                    <div className="mt-4 space-y-2 max-w-md mx-auto">
                      {[
                        'What does the Norwegian Method say about my training?',
                        'Should I do more threshold work?',
                        'Am I overtraining or undertraining?',
                        'How would you structure my training differently?',
                      ].map((example) => (
                        <button
                          key={example}
                          onClick={() => setInput(example)}
                          className="block w-full text-sm px-4 py-2 rounded-lg bg-accent hover:bg-accent/80 transition-colors text-left"
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
                      className={`flex gap-3 ${
                        message.role === 'user' ? 'justify-end' : 'justify-start'
                      }`}
                    >
                      {message.role === 'assistant' && (
                        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shrink-0">
                          <Dumbbell className="w-4 h-4 text-white" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
                          message.role === 'user'
                            ? 'bg-orange-500 text-white'
                            : 'bg-accent'
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
                      <div className="w-8 h-8 rounded-full bg-gradient-to-br from-orange-500 to-red-500 flex items-center justify-center shrink-0">
                        <Dumbbell className="w-4 h-4 text-white" />
                      </div>
                      <div className="bg-accent rounded-2xl px-4 py-3">
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
                  placeholder="Ask Grocky..."
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
                  className="btn-gradient-secondary shrink-0 coach-button-accessible"
                  aria-label="Send message"
                >
                  <Send className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        {/* Plan Review Tab */}
        <TabsContent value="review">
          <Card className="coach-card">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="coach-heading flex items-center gap-2">
                  <div className={`ai-icon-container p-2 rounded-lg bg-gradient-to-br from-orange-500/15 to-red-500/15 ${reviewLoading ? 'active ai-pulse' : ''}`}>
                    <FileSearch className="w-5 h-5 text-orange-500" />
                  </div>
                  Training Plan Review
                </CardTitle>
                <CardDescription>
                  Get Grocky&apos;s comprehensive analysis of your current training plan.
                </CardDescription>
              </div>
              {planReview && (
                <Button variant="outline" size="sm" onClick={handleClearReview} className="coach-button-focus">
                  <Trash2 className="w-4 h-4 mr-2" />
                  Clear
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {!planReview && !reviewLoading && (
                <div className="empty-state">
                  <FileSearch className="empty-state-icon text-orange-500/50" />
                  <p className="font-medium">Get an evidence-based second opinion</p>
                  <p className="text-sm mt-1 mb-4">
                    Grocky will analyze your training plan and provide feedback.
                  </p>
                  <Button
                    onClick={handlePlanReview}
                    className="btn-gradient-secondary coach-button-accessible"
                  >
                    <Dumbbell className="w-4 h-4 mr-2" />
                    Review My Plan
                  </Button>
                </div>
              )}

              {reviewLoading && (
                <div className="space-y-4 p-4 bg-gradient-to-br from-orange-500/5 to-red-500/5 rounded-lg">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-5/6" />
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
              )}

              {planReview && (
                <div className="prose dark:prose-invert max-w-none">
                  <div className="whitespace-pre-wrap text-sm leading-relaxed bg-gradient-to-br from-orange-500/5 to-red-500/5 p-4 rounded-lg border border-border/50">
                    {planReview}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
