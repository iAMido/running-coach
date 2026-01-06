'use client';

import Image from 'next/image';

export function StackSection() {
  return (
    <section className="py-20 bg-background dark:bg-[#1C1C1E]">
      <div className="container mx-auto px-6 max-w-5xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-4">
            Tech Stack
          </h2>
          <p className="text-muted-foreground text-lg max-w-2xl mx-auto">
            Built with modern technologies for blazing-fast performance and developer experience
          </p>
        </div>

        <div className="relative w-full aspect-[16/9] rounded-2xl overflow-hidden shadow-2xl border border-border/50">
          <Image
            src="https://cdn.hailuoai.video/moss/prod/2026-01-06-18/user/multi_chat_file/1767693880950248428-304191379171532808_1767693879.jpg"
            alt="Tech Stack - Next.js, Bun, TypeScript, Tailwind CSS, Shadcn/ui"
            fill
            className="object-cover"
            priority
          />
        </div>
      </div>
    </section>
  );
}
