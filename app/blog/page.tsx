'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { ArrowLeft, Clock, Calendar, ArrowRight } from 'lucide-react';
import { getAllPosts } from '@/lib/blog';

const categoryColors: Record<string, string> = {
  Engineering: '#FF4D8E',
  Design: '#00C2FF',
  Framework: '#FF9100',
};

export default function BlogPage() {
  const posts = getAllPosts();

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#FFF5F8] via-background to-background dark:from-[#1C1C1E] dark:via-[#1C1C1E] dark:to-[#1C1C1E]">
      {/* Back to Home */}
      <div className="container mx-auto px-6 pt-28">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Home
        </Link>
      </div>

      {/* Header */}
      <header className="container mx-auto px-6 pb-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <h1 className="text-4xl md:text-5xl font-bold text-foreground mb-4">
            Blog
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl">
            Thoughts on building modern web applications, the tools we use, and the decisions that shape our stack.
          </p>
        </motion.div>
      </header>

      {/* Posts Grid */}
      <section className="container mx-auto px-6 pb-24">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((post, index) => (
            <motion.article
              key={post.slug}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: index * 0.1 }}
            >
              <Link href={`/blog/${post.slug}`} className="block group">
                <div className="h-full rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-md border border-white/30 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.2)] p-6 transition-all duration-300 hover:scale-[1.02] hover:shadow-[0_12px_40px_rgba(0,0,0,0.1)] dark:hover:shadow-[0_12px_40px_rgba(0,0,0,0.3)]">
                  {/* Category & Reading Time */}
                  <div className="flex items-center gap-3 mb-4">
                    <span
                      className="px-3 py-1 rounded-full text-xs font-medium text-white"
                      style={{ backgroundColor: categoryColors[post.category] || '#FF4D8E' }}
                    >
                      {post.category}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      {post.readingTime} min read
                    </span>
                  </div>

                  {/* Title */}
                  <h2 className="text-xl font-semibold text-foreground mb-3 group-hover:text-[#FF4D8E] transition-colors">
                    {post.title}
                  </h2>

                  {/* Excerpt */}
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {post.excerpt}
                  </p>

                  {/* Footer */}
                  <div className="flex items-center justify-between pt-4 border-t border-white/10 dark:border-white/5">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      {post.date}
                    </span>
                    <span className="flex items-center gap-1 text-sm font-medium text-[#FF4D8E] group-hover:gap-2 transition-all">
                      Read article
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </div>
              </Link>
            </motion.article>
          ))}
        </div>
      </section>
    </main>
  );
}
