import { config, fields, collection } from '@keystatic/core';

export default config({
  storage: {
    kind: 'local',
  },
  collections: {
    posts: collection({
      label: 'Blog Posts',
      slugField: 'title',
      path: 'src/content/posts/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        description: fields.text({ label: 'Meta Description', multiline: true }),
        category: fields.select({
          label: 'Category',
          options: [
            { label: 'Trader Intelligence', value: 'trader-intelligence' },
            { label: 'Convergence Signals', value: 'convergence-signals' },
            { label: 'Market Strategy', value: 'market-strategy' },
            { label: 'Polymarket Guides', value: 'polymarket-guides' },
          ],
          defaultValue: 'trader-intelligence',
        }),
        publishedDate: fields.date({ label: 'Published Date' }),
        ogImage: fields.text({ label: 'OG Image URL (optional)' }),
        content: fields.markdoc({ label: 'Content' }),
      },
    }),
  },
});
