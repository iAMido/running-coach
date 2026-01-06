'use client';

import { motion } from 'framer-motion';
import { ProjectCard, Brain, Code2, Database, Mic, TestTube, BarChart3 } from '@/components/ui/project-card';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

const featuredProjects = [
  {
    title: 'AI-Powered Code Assistant',
    description: 'Building intelligent development tools that accelerate software creation with context-aware AI suggestions.',
    tags: ['AI/ML', 'Developer Tools'],
    icon: Brain,
    gradient: 'pink' as const,
  },
  {
    title: 'Real-time Data Pipeline',
    description: 'Scalable data infrastructure processing millions of events per second with sub-millisecond latency.',
    tags: ['Backend', 'Infrastructure'],
    icon: Database,
    gradient: 'blue' as const,
  },
  {
    title: 'ML Model Orchestration',
    description: 'End-to-end machine learning pipeline for training, deploying, and monitoring production ML models.',
    tags: ['MLOps', 'Cloud'],
    icon: Code2,
    gradient: 'orange' as const,
  },
  {
    title: 'Voice AI Platform',
    description: 'Natural language processing system enabling conversational AI experiences across multiple channels.',
    tags: ['NLP', 'Voice AI'],
    icon: Mic,
    gradient: 'purple' as const,
  },
  {
    title: 'Automated Testing Suite',
    description: 'Comprehensive testing framework with AI-driven test generation and intelligent coverage analysis.',
    tags: ['Testing', 'Automation'],
    icon: TestTube,
    gradient: 'teal' as const,
  },
  {
    title: 'Developer Analytics',
    description: 'Insights platform tracking developer productivity metrics and codebase health indicators.',
    tags: ['Analytics', 'DevOps'],
    icon: BarChart3,
    gradient: 'brand' as const,
  },
];

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.25, 0.4, 0.25, 1] as const,
    },
  },
};

export function FeaturedWorkSection() {
  return (
    <section id="projects" className="py-24 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-100px' }}
          transition={{ duration: 0.6 }}
          className="flex items-end justify-between mb-12"
        >
          <div>
            <h2 className="text-4xl md:text-5xl font-bold text-white mb-3">
              Featured Work
            </h2>
            <p className="text-white/60 text-lg max-w-xl">
              A selection of projects showcasing AI innovation and technical excellence
            </p>
          </div>
          <Link
            href="#"
            className="hidden md:flex items-center gap-2 text-[#FF4D8E] hover:text-[#FF4D8E]/80 transition-colors font-medium group"
          >
            See All
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </motion.div>

        {/* Project Grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-50px' }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {featuredProjects.map((project, index) => (
            <motion.div key={index} variants={itemVariants}>
              <ProjectCard
                title={project.title}
                description={project.description}
                tags={project.tags}
                icon={project.icon}
                gradient={project.gradient}
              />
            </motion.div>
          ))}
        </motion.div>

        {/* Mobile See All Link */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 0.4 }}
          className="md:hidden mt-8 text-center"
        >
          <Link
            href="#"
            className="inline-flex items-center gap-2 text-[#FF4D8E] hover:text-[#FF4D8E]/80 transition-colors font-medium"
          >
            See All Projects
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
