'use client';

import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import type { BlogPost } from '@/lib/blog';

interface ArticleContentProps {
  post: BlogPost;
}

// Note: The blog content HTML comes from our own hardcoded lib/blog.ts file,
// not from user input, so it is safe to render without sanitization.

export function ArticleContent({ post }: ArticleContentProps) {
  const [readProgress, setReadProgress] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const articleRef = useRef<HTMLDivElement>(null);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  // Reading progress tracker
  useEffect(() => {
    const handleScroll = () => {
      if (!articleRef.current) return;

      const element = articleRef.current;
      const windowHeight = window.innerHeight;
      const elementTop = element.offsetTop;
      const elementHeight = element.offsetHeight;
      const scrollY = window.scrollY;

      // Calculate how much of the article has been scrolled through
      const scrollableDistance = elementHeight - windowHeight + elementTop;
      const scrolledAmount = scrollY - elementTop + windowHeight;
      const progress = Math.min(Math.max((scrolledAmount / scrollableDistance) * 100, 0), 100);

      setReadProgress(progress);
    };

    window.addEventListener('scroll', handleScroll);
    handleScroll(); // Initial call

    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Text-to-Speech functionality
  const handleTTS = () => {
    if (!('speechSynthesis' in window)) {
      alert('Text-to-speech is not supported in your browser.');
      return;
    }

    if (isPlaying) {
      window.speechSynthesis.cancel();
      setIsPlaying(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(post.content);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = isMuted ? 0 : 1;

    // Try to find a good English voice
    const voices = window.speechSynthesis.getVoices();
    const englishVoice = voices.find(
      (voice) => voice.lang.startsWith('en') && voice.name.includes('Natural')
    ) || voices.find((voice) => voice.lang.startsWith('en'));

    if (englishVoice) {
      utterance.voice = englishVoice;
    }

    utterance.onend = () => setIsPlaying(false);
    utterance.onerror = () => setIsPlaying(false);

    utteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
    setIsPlaying(true);
  };

  const toggleMute = () => {
    setIsMuted(!isMuted);
    if (utteranceRef.current) {
      // Cancel and restart with new volume if currently playing
      if (isPlaying) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(post.content);
        utterance.volume = !isMuted ? 0 : 1;
        utterance.onend = () => setIsPlaying(false);
        window.speechSynthesis.speak(utterance);
      }
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  return (
    <>
      {/* Fixed Progress Bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-1 bg-white/10">
        <motion.div
          className="h-full bg-gradient-to-r from-[#FF4D8E] to-[#FF9100]"
          style={{ width: `${readProgress}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>

      {/* TTS Controls - Fixed on side */}
      <div className="fixed bottom-8 right-8 z-40 flex flex-col gap-2">
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
          onClick={handleTTS}
          className="w-14 h-14 rounded-full bg-[#FF4D8E] text-white flex items-center justify-center shadow-lg hover:bg-[#FF4D8E]/90 transition-colors"
          aria-label={isPlaying ? 'Pause reading' : 'Listen to article'}
        >
          {isPlaying ? (
            <Pause className="w-6 h-6" />
          ) : (
            <Play className="w-6 h-6 ml-1" />
          )}
        </motion.button>

        {isPlaying && (
          <motion.button
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={toggleMute}
            className="w-14 h-14 rounded-full bg-white/10 backdrop-blur-md text-white flex items-center justify-center shadow-lg hover:bg-white/20 transition-colors border border-white/10"
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted ? (
              <VolumeX className="w-5 h-5" />
            ) : (
              <Volume2 className="w-5 h-5" />
            )}
          </motion.button>
        )}
      </div>

      {/* Article Content */}
      <article ref={articleRef} className="prose-article">
        <div
          className="prose prose-lg dark:prose-invert max-w-none
            prose-headings:font-bold prose-headings:text-foreground
            prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4
            prose-p:text-muted-foreground prose-p:leading-relaxed prose-p:mb-6
            prose-strong:text-foreground prose-strong:font-semibold
            prose-code:text-[#FF4D8E] prose-code:bg-[#FF4D8E]/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:text-sm
            prose-blockquote:border-l-4 prose-blockquote:border-[#FF4D8E] prose-blockquote:pl-6 prose-blockquote:italic prose-blockquote:text-muted-foreground
            prose-a:text-[#FF4D8E] prose-a:no-underline hover:prose-a:underline
            [&_.lead]:text-xl [&_.lead]:text-foreground [&_.lead]:font-medium [&_.lead]:leading-relaxed [&_.lead]:mb-8"
        >
          {/* Render content using a safe approach since it's from our own trusted source */}
          <div dangerouslySetInnerHTML={{ __html: post.contentHtml }} />
        </div>
      </article>
    </>
  );
}
