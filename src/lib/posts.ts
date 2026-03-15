export function getReadTime(text: string): string {
  const words = text.split(/\s+/).length;
  const minutes = Math.ceil(words / 200);
  return `${minutes} min read`;
}

export const categoryLabels: Record<string, string> = {
  'trader-intelligence': 'Trader Intelligence',
  'convergence-signals': 'Convergence Signals',
  'market-strategy': 'Market Strategy',
  'polymarket-guides': 'Polymarket Guides',
};

export const categories = Object.keys(categoryLabels);
