import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Clock, Calendar } from 'lucide-react';
import { getPostBySlug, getAllSlugs } from '@/lib/blog';
import { ArticleContent } from '@/components/blog/article-content';

const categoryColors: Record<string, string> = {
  Engineering: '#FF4D8E',
  Design: '#00C2FF',
  Framework: '#FF9100',
};

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  const slugs = getAllSlugs();
  return slugs.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: BlogPostPageProps) {
  const resolvedParams = await params;
  const post = getPostBySlug(resolvedParams.slug);

  if (!post) {
    return {
      title: 'Post Not Found',
    };
  }

  return {
    title: `${post.title} | YUV.AI Blog`,
    description: post.excerpt,
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  const resolvedParams = await params;
  const post = getPostBySlug(resolvedParams.slug);

  if (!post) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-gradient-to-b from-[#FFF5F8] via-background to-background dark:from-[#1C1C1E] dark:via-[#1C1C1E] dark:to-[#1C1C1E]">
      {/* Back Navigation */}
      <div className="container mx-auto px-6 pt-28">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Blog
        </Link>
      </div>

      {/* Article Header */}
      <header className="container mx-auto px-6 pb-12 max-w-3xl">
        {/* Category & Meta */}
        <div className="flex items-center gap-4 mb-6">
          <span
            className="px-3 py-1 rounded-full text-xs font-medium text-white"
            style={{ backgroundColor: categoryColors[post.category] || '#FF4D8E' }}
          >
            {post.category}
          </span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Clock className="w-4 h-4" />
            {post.readingTime} min read
          </span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            <Calendar className="w-4 h-4" />
            {post.date}
          </span>
        </div>

        {/* Title */}
        <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold text-foreground leading-tight mb-6">
          {post.title}
        </h1>

        {/* Author */}
        <div className="flex items-center gap-3">
          <img
            src="https://cdn.hailuoai.video/moss/prod/2026-01-01-02/user/multi_chat_file/1767204442417679023-304191379171532808_1767204439.jpg"
            alt={post.author.name}
            className="w-10 h-10 rounded-full border-2 border-[#FF4D8E]/50"
          />
          <div>
            <p className="text-sm font-medium text-foreground">{post.author.name}</p>
            <p className="text-xs text-muted-foreground">Author</p>
          </div>
        </div>
      </header>

      {/* Article Content */}
      <section className="container mx-auto px-6 pb-24 max-w-3xl">
        <div className="rounded-2xl bg-white/60 dark:bg-white/5 backdrop-blur-md border border-white/30 dark:border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.06)] dark:shadow-[0_8px_32px_rgba(0,0,0,0.2)] p-8 md:p-12">
          <ArticleContent post={post} />
        </div>
      </section>
    </main>
  );
}
