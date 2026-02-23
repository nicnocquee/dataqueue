/**
 * Build script that reads all MDX documentation files, strips MDX-specific
 * components, and outputs a JSON file for the MCP server to search.
 *
 * Usage: npx tsx ai/build-docs-content.ts
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

const DOCS_DIR = path.resolve(__dirname, '../../../apps/docs/content/docs');
const OUTPUT_FILE = path.resolve(__dirname, 'docs-content.json');

function extractFrontmatter(raw: string): {
  title: string;
  description: string;
  body: string;
} {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { title: '', description: '', body: raw };

  const fm = match[1];
  const body = match[2];

  const titleMatch = fm.match(/^title:\s*(.+)$/m);
  const descMatch = fm.match(/^description:\s*(.+)$/m);

  return {
    title: titleMatch ? titleMatch[1].trim() : '',
    description: descMatch ? descMatch[1].trim() : '',
    body,
  };
}

function stripMdxComponents(content: string): string {
  return (
    content
      .replace(/<Callout[^>]*>\s*/g, '> **Note:** ')
      .replace(/<\/Callout>\s*/g, '\n')
      .replace(/<Steps>|<\/Steps>/g, '')
      .replace(/<Step[^>]*>/g, '')
      .replace(/<\/Step>/g, '')
      .replace(/!\[.*?\]\(\/[^)]+\)/g, '')
      // Strip code annotations like [!code highlight] and [!code highlight:N]
      .replace(/\s*\/\/\s*\[!code\s+highlight(?::\d+)?\]\s*/g, '')
      .replace(/```package-install\n/g, '```bash\n')
      .trim()
  );
}

function collectMdxFiles(dir: string, prefix = ''): DocPage[] {
  const pages: DocPage[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isDirectory()) {
      pages.push(
        ...collectMdxFiles(
          path.join(dir, entry.name),
          `${prefix}${entry.name}/`,
        ),
      );
    } else if (entry.name.endsWith('.mdx')) {
      const raw = fs.readFileSync(path.join(dir, entry.name), 'utf-8');
      const { title, description, body } = extractFrontmatter(raw);
      const slug =
        entry.name === 'index.mdx'
          ? prefix.replace(/\/$/, '') || 'index'
          : `${prefix}${entry.name.replace(/\.mdx$/, '')}`;

      pages.push({
        slug,
        title,
        description,
        content: stripMdxComponents(body),
      });
    }
  }

  return pages;
}

const pages = collectMdxFiles(DOCS_DIR);
fs.writeFileSync(OUTPUT_FILE, JSON.stringify(pages, null, 2));
console.log(`Built ${pages.length} doc pages to ${OUTPUT_FILE}`);
