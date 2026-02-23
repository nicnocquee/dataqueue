/**
 * Generates llms-full.txt from docs-content.json — a single concatenated file
 * of all documentation, suitable for feeding into an LLM context window.
 *
 * Usage: npx tsx ai/build-llms-full.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DocPage {
  slug: string;
  title: string;
  description: string;
  content: string;
}

const INPUT = path.resolve(__dirname, 'docs-content.json');
const OUTPUT = path.resolve(
  __dirname,
  '../../../apps/docs/public/llms-full.txt',
);

const pages: DocPage[] = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));

const sections = pages.map((page) => {
  const header = page.description
    ? `# ${page.title}\n\n> ${page.description}`
    : `# ${page.title}`;
  return `${header}\n\nSlug: ${page.slug}\n\n${page.content}`;
});

const output = `# DataQueue — Full Documentation\n\n${sections.join('\n\n---\n\n')}\n`;

fs.writeFileSync(OUTPUT, output);
console.log(
  `Built llms-full.txt (${pages.length} pages, ${output.length} chars)`,
);
