import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.mdoc', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    metaTitle: z.string().optional().default(''),
    description: z.string(),
    category: z.string(),
    publishedDate: z.string(),
    ogImage: z.string().optional().default(''),
  }),
});

export const collections = { posts };
