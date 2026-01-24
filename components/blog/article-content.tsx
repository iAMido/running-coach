'use client';

import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { ArrowLeft, Play, Pause, Square, Volume2, VolumeX, SkipBack, Settings, X } from 'lucide-react';
import { BlogPost } from '@/lib/blog';
import DOMPurify from 'dompurify';

// Note: Even though blog content HTML comes from our own hardcoded lib/blog.ts file,
// we sanitize it as defense-in-depth in case the content source changes in the future.

interface ArticleContentProps {
  post: BlogPost;
}

export function ArticleContent({ post }: ArticleContentProps) {
  // Reading progress
  const [progress, setProgress] = useState(0);

  // TTS state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(false);
  const [currentWordIndex, setCurrentWordIndex] = useState(-1);
  const [words, setWords] = useState<string[]>([]);
  const [showPlayer, setShowPlayer] = useState(false);

  // Voice & Speed settings
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState<SpeechSynthesisVoice | null>(null);
  const [speed, setSpeed] = useState(1);
  const [showSettings, setShowSettings] = useState(false);

  // Sanitize HTML content to prevent XSS attacks
  const sanitizedHtml = useMemo(() => {
    if (typeof window === 'undefined') return post.contentHtml;
    return DOMPurify.sanitize(post.contentHtml, {
      ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'b', 'i', 'u', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
        'ul', 'ol', 'li', 'a', 'blockquote', 'code', 'pre', 'img', 'span', 'div'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
      ALLOW_DATA_ATTR: false,
    });
  }, [post.contentHtml]);

  // Refs
  const articleRef = useRef<HTMLDivElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Check TTS support
  useEffect(() => {
    setTtsSupported('speechSynthesis' in window);
  }, []);

  // Load available voices
  useEffect(() => {
    if (!ttsSupported) return;

    const loadVoices = () => {
      const availableVoices = speechSynthesis.getVoices();
      if (availableVoices.length === 0) return;

      const englishVoices = availableVoices.filter(v => v.lang.startsWith('en'));
      const voicesToUse = englishVoices.length > 0 ? englishVoices : availableVoices;
      setVoices(voicesToUse);

      if (!selectedVoice) {
        const preferredVoice = voicesToUse.find(v =>
          v.name.includes('Google') || v.name.includes('Microsoft') || v.name.includes('Natural') || v.name.includes('Samantha')
        ) || voicesToUse[0];
        setSelectedVoice(preferredVoice);
      }
    };

    loadVoices();

    if (speechSynthesis.onvoiceschanged !== undefined) {
      speechSynthesis.onvoiceschanged = loadVoices;
    }

    return () => {
      if (speechSynthesis.onvoiceschanged !== undefined) {
        speechSynthesis.onvoiceschanged = null;
      }
    };
  }, [ttsSupported, selectedVoice]);

  // Parse words for progress tracking
  useEffect(() => {
    if (post.content) {
      const wordArray = post.content.split(/\s+/).filter(w => w.length > 0);
      setWords(wordArray);
    }
  }, [post.content]);

  // Reading Progress Bar (scroll-based)
  useEffect(() => {
    const handleScroll = () => {
      if (!articleRef.current) return;

      const article = articleRef.current;
      const articleTop = article.offsetTop;
      const articleHeight = article.offsetHeight;
      const windowHeight = window.innerHeight;
      const scrollY = window.scrollY;

      const start = articleTop - windowHeight + 100;
      const end = articleTop + articleHeight - windowHeight;
      const current = scrollY - start;
      const total = end - start;

      const percentage = Math.min(Math.max((current / total) * 100, 0), 100);
      setProgress(percentage);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Initialize TTS with selected voice and speed
  const initTTS = useCallback(() => {
    if (!ttsSupported || !post.content) return;

    const utterance = new SpeechSynthesisUtterance(post.content);
    utterance.rate = speed;
    utterance.pitch = 1;

    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }

    let wordIndex = 0;
    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        setCurrentWordIndex(wordIndex);
        wordIndex++;
      }
    };

    utterance.onend = () => {
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentWordIndex(-1);
      setShowPlayer(false);
    };

    utterance.onerror = () => {
      setIsPlaying(false);
      setIsPaused(false);
      setCurrentWordIndex(-1);
    };

    utteranceRef.current = utterance;
  }, [ttsSupported, post.content, selectedVoice, speed]);

  useEffect(() => {
    initTTS();
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        speechSynthesis.cancel();
      }
    };
  }, [initTTS]);

  const handlePlay = () => {
    if (isPaused) {
      speechSynthesis.resume();
      setIsPaused(false);
      setIsPlaying(true);
    } else {
      speechSynthesis.cancel();
      setCurrentWordIndex(-1);
      initTTS();
      if (utteranceRef.current) {
        speechSynthesis.speak(utteranceRef.current);
        setIsPlaying(true);
        setShowPlayer(true);
      }
    }
  };

  const handlePause = () => {
    speechSynthesis.pause();
    setIsPaused(true);
    setIsPlaying(false);
  };

  const handleStop = () => {
    speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentWordIndex(-1);
    setShowPlayer(false);
    setShowSettings(false);
  };

  const handleRestart = () => {
    speechSynthesis.cancel();
    setCurrentWordIndex(-1);
    initTTS();
    if (utteranceRef.current) {
      speechSynthesis.speak(utteranceRef.current);
      setIsPlaying(true);
    }
  };

  // Calculate TTS progress based on word index
  const ttsProgress = words.length > 0 ? (currentWordIndex / words.length) * 100 : 0;

  return (
    <>
      {/* Reading Progress Bar - Fixed at very top */}
      <div className="fixed top-0 left-0 right-0 z-[200] h-1 bg-gray-200/50 dark:bg-gray-800/50">
        <div
          className="h-full bg-gradient-to-r from-[#2563EB] via-[#10B981] to-[#0EA5E9] transition-all duration-100 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* Article */}
      <main className="pt-24 md:pt-28 pb-24 md:pb-32 min-h-screen">
        <article className="container mx-auto px-4 md:px-6 max-w-3xl">
          {/* Back Link */}
          <Link
            href="/blog"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-6 md:mb-8"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Blog
          </Link>

          {/* Article Header */}
          <header className="mb-8 md:mb-12">
            <div className="flex flex-wrap items-center gap-2 md:gap-3 mb-4 md:mb-6">
              <span className="text-xs md:text-sm font-medium px-2 md:px-3 py-1 rounded-full bg-[#2563EB]/10 text-[#2563EB]">
                {post.category}
              </span>
              <span className="text-xs md:text-sm text-muted-foreground">
                {post.readingTime} min read
              </span>
              <span className="text-xs md:text-sm text-muted-foreground">
                {post.date}
              </span>
            </div>

            <h1 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-foreground mb-4 md:mb-6 leading-tight">
              {post.title}
            </h1>

            <p className="text-base md:text-xl text-muted-foreground mb-6 md:mb-8 leading-relaxed">
              {post.excerpt}
            </p>

            {/* Author + Listen Button - stack on small mobile */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 md:pb-8 border-b border-border">
              <div className="flex items-center gap-3 md:gap-4">
                <div className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-gradient-to-br from-[#2563EB] to-[#10B981] flex items-center justify-center text-white font-semibold text-sm md:text-base overflow-hidden">
                  <span>IM</span>
                </div>
                <div>
                  <p className="font-medium text-foreground text-sm md:text-base">{post.author.name}</p>
                  <p className="text-xs md:text-sm text-muted-foreground">Author</p>
                </div>
              </div>

              {/* Listen Button - full width on mobile */}
              {ttsSupported && !showPlayer && (
                <button
                  onClick={handlePlay}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 md:px-5 py-2.5 rounded-full bg-[#2563EB] text-white hover:bg-[#2563EB]/90 transition-colors shadow-lg shadow-[#2563EB]/25"
                >
                  <Volume2 className="w-4 h-4" />
                  <span className="text-sm font-medium">Listen</span>
                </button>
              )}
            </div>
          </header>

          {/* Article Body - Mobile typography */}
          <div
            ref={articleRef}
            className="
              prose
              prose-sm
              md:prose-lg
              dark:prose-invert
              max-w-none

              prose-headings:font-semibold
              prose-headings:text-foreground

              prose-h2:text-xl
              md:prose-h2:text-2xl
              prose-h2:mt-10
              md:prose-h2:mt-14
              prose-h2:mb-4
              md:prose-h2:mb-6

              prose-h3:text-lg
              md:prose-h3:text-xl
              prose-h3:mt-8
              md:prose-h3:mt-10
              prose-h3:mb-3
              md:prose-h3:mb-4

              prose-p:text-sm
              md:prose-p:text-base
              prose-p:text-foreground/80
              prose-p:leading-relaxed
              md:prose-p:leading-[1.8]
              prose-p:mb-4
              md:prose-p:mb-6

              [&>p:first-of-type]:text-base
              md:[&>p:first-of-type]:text-xl
              [&>p:first-of-type]:text-foreground/70
              [&>p:first-of-type]:leading-relaxed
              [&>p:first-of-type]:mb-6
              md:[&>p:first-of-type]:mb-8

              prose-a:text-[#2563EB]
              prose-a:no-underline
              hover:prose-a:underline

              prose-strong:text-foreground
              prose-strong:font-semibold

              prose-code:text-[#2563EB]
              prose-code:bg-[#2563EB]/10
              prose-code:px-1
              md:prose-code:px-1.5
              prose-code:py-0.5
              prose-code:rounded
              prose-code:font-normal
              prose-code:text-xs
              md:prose-code:text-sm
              prose-code:before:content-none
              prose-code:after:content-none

              prose-pre:bg-[#1C1C1E]
              prose-pre:border
              prose-pre:border-white/10
              prose-pre:rounded-lg
              md:prose-pre:rounded-xl
              prose-pre:my-6
              md:prose-pre:my-8
              prose-pre:text-xs
              md:prose-pre:text-sm

              prose-blockquote:border-l-[#2563EB]
              prose-blockquote:border-l-4
              prose-blockquote:bg-[#2563EB]/5
              prose-blockquote:py-3
              md:prose-blockquote:py-4
              prose-blockquote:px-4
              md:prose-blockquote:px-6
              prose-blockquote:rounded-r-lg
              md:prose-blockquote:rounded-r-xl
              prose-blockquote:not-italic
              prose-blockquote:my-6
              md:prose-blockquote:my-8
              prose-blockquote:text-foreground/80

              prose-ul:my-4
              md:prose-ul:my-6
              prose-ul:space-y-2
              md:prose-ul:space-y-3
              prose-ol:my-4
              md:prose-ol:my-6
              prose-ol:space-y-2
              md:prose-ol:space-y-3
              prose-li:text-foreground/80
              prose-li:leading-relaxed
              prose-li:text-sm
              md:prose-li:text-base
            "
            dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
          />

          {/* Article Footer */}
          <footer className="mt-12 md:mt-16 pt-6 md:pt-8 border-t border-border">
            <Link
              href="/blog"
              className="inline-flex items-center gap-2 text-sm md:text-base text-[#2563EB] hover:underline font-medium"
            >
              <ArrowLeft className="w-4 h-4" />
              More articles
            </Link>
          </footer>
        </article>
      </main>

      {/* Spotify-Style Bottom Audio Player */}
      {showPlayer && (
        <div className="fixed bottom-0 left-0 right-0 z-[200]">
          {/* TTS Progress Bar */}
          <div className="h-1 bg-gray-200 dark:bg-gray-800 cursor-pointer">
            <div
              className="h-full bg-[#2563EB] transition-all duration-300"
              style={{ width: `${ttsProgress}%` }}
            />
          </div>

          {/* Player Controls */}
          <div className="
            bg-white/95
            dark:bg-[#1C1C1E]/95
            backdrop-blur-xl
            border-t
            border-gray-200
            dark:border-white/10
            px-3
            md:px-6
            py-3
            md:py-4
            safe-area-inset-bottom
          ">
            <div className="flex items-center justify-between gap-2 md:gap-4 max-w-4xl mx-auto">
              {/* Left: Track Info - hide text on very small screens */}
              <div className="flex items-center gap-2 md:gap-3 flex-1 min-w-0">
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#2563EB] to-[#10B981] flex items-center justify-center flex-shrink-0">
                  <Volume2 className="w-5 h-5 text-white" />
                </div>
                <div className="min-w-0 hidden sm:block">
                  <p className="font-medium text-foreground text-xs md:text-sm truncate max-w-[120px] md:max-w-none">
                    {post.title}
                  </p>
                  <p className="text-xs text-muted-foreground">{speed}x</p>
                </div>
              </div>

              {/* Center: Playback Controls */}
              <div className="flex items-center gap-1 md:gap-4">
                <button
                  onClick={handleRestart}
                  className="p-1.5 md:p-2 text-muted-foreground hover:text-foreground transition-colors"
                  title="Restart"
                >
                  <SkipBack className="w-4 h-4 md:w-5 md:h-5" />
                </button>

                <button
                  onClick={isPlaying ? handlePause : handlePlay}
                  className="w-10 h-10 md:w-12 md:h-12 rounded-full bg-[#2563EB] text-white flex items-center justify-center hover:bg-[#2563EB]/90 transition-colors shadow-lg"
                >
                  {isPlaying ? (
                    <Pause className="w-4 h-4 md:w-5 md:h-5" />
                  ) : (
                    <Play className="w-4 h-4 md:w-5 md:h-5 ml-0.5" />
                  )}
                </button>

                <button
                  onClick={handleStop}
                  className="p-1.5 md:p-2 text-muted-foreground hover:text-foreground transition-colors"
                  title="Stop"
                >
                  <Square className="w-3 h-3 md:w-4 md:h-4" />
                </button>
              </div>

              {/* Right: Settings & Close */}
              <div className="flex items-center gap-1 flex-1 justify-end">
                {/* Settings Button */}
                <div className="relative">
                  <button
                    onClick={() => setShowSettings(!showSettings)}
                    className={`p-1.5 md:p-2 rounded-full transition-colors ${showSettings ? 'bg-[#2563EB]/10 text-[#2563EB]' : 'text-muted-foreground hover:text-foreground'}`}
                    title="Settings"
                  >
                    <Settings className="w-4 h-4 md:w-5 md:h-5" />
                  </button>

                  {/* Settings Dropdown - position above on mobile */}
                  {showSettings && (
                    <div className="absolute bottom-full right-0 mb-3 w-64 md:w-72 p-3 md:p-4 rounded-xl md:rounded-2xl bg-white dark:bg-[#1C1C1E] border border-gray-200 dark:border-white/10 shadow-2xl">
                      <div className="flex items-center justify-between mb-3 md:mb-4">
                        <h4 className="font-semibold text-foreground text-sm md:text-base">Playback Settings</h4>
                        <button
                          onClick={() => setShowSettings(false)}
                          className="p-1 hover:bg-gray-100 dark:hover:bg-white/10 rounded-full"
                        >
                          <X className="w-4 h-4 text-muted-foreground" />
                        </button>
                      </div>

                      {/* Speed Control */}
                      <div className="mb-4 md:mb-5">
                        <label className="text-xs md:text-sm font-medium text-foreground mb-2 md:mb-3 flex items-center justify-between">
                          <span>Speed</span>
                          <span className="text-[#2563EB]">{speed}x</span>
                        </label>
                        <input
                          type="range"
                          min="0.5"
                          max="2"
                          step="0.25"
                          value={speed}
                          onChange={(e) => {
                            const newSpeed = parseFloat(e.target.value);
                            setSpeed(newSpeed);
                          }}
                          className="w-full h-2 bg-gray-200 dark:bg-white/10 rounded-full appearance-none cursor-pointer accent-[#2563EB]"
                        />
                        <div className="flex justify-between text-xs text-muted-foreground mt-1 md:mt-2">
                          <span>0.5x</span>
                          <span>1x</span>
                          <span>1.5x</span>
                          <span>2x</span>
                        </div>
                      </div>

                      {/* Voice Selection */}
                      {voices.length > 0 && (
                        <div>
                          <label className="text-xs md:text-sm font-medium text-foreground mb-2 block">
                            Voice
                          </label>
                          <select
                            value={selectedVoice?.name || ''}
                            onChange={(e) => {
                              const voice = voices.find(v => v.name === e.target.value);
                              setSelectedVoice(voice || null);
                            }}
                            className="w-full p-2 md:p-2.5 rounded-lg md:rounded-xl bg-gray-100 dark:bg-white/10 border-0 text-foreground text-xs md:text-sm focus:ring-2 focus:ring-[#2563EB] cursor-pointer"
                          >
                            {voices.map((voice) => (
                              <option key={voice.name} value={voice.name}>
                                {voice.name.replace('Microsoft ', '').replace('Google ', '').replace(' (Natural)', '')}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}

                      <p className="text-xs text-muted-foreground mt-3 md:mt-4">
                        Changes apply when you restart
                      </p>
                    </div>
                  )}
                </div>

                {/* Close Button */}
                <button
                  onClick={handleStop}
                  className="p-1.5 md:p-2 text-muted-foreground hover:text-foreground transition-colors"
                  title="Close player"
                >
                  <X className="w-4 h-4 md:w-5 md:h-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
