#!/usr/bin/env node

/**
 * DataQueue MCP Server — exposes documentation search over stdio.
 * Run via: dataqueue-cli mcp
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DocPage {
  slug: string;
  title: string;
  description: string;
  content: string;
}

/** @internal Loads docs-content.json from the ai/ directory bundled with the package. */
export function loadDocsContent(
  docsPath: string = path.join(__dirname, '../ai/docs-content.json'),
): DocPage[] {
  const raw = fs.readFileSync(docsPath, 'utf-8');
  return JSON.parse(raw) as DocPage[];
}

/** @internal Scores a doc page against a search query using simple term matching. */
export function scorePageForQuery(page: DocPage, queryTerms: string[]): number {
  const titleLower = page.title.toLowerCase();
  const descLower = page.description.toLowerCase();
  const contentLower = page.content.toLowerCase();

  let score = 0;
  for (const term of queryTerms) {
    if (titleLower.includes(term)) score += 10;
    if (descLower.includes(term)) score += 5;

    const contentMatches = contentLower.split(term).length - 1;
    score += Math.min(contentMatches, 10);
  }
  return score;
}

/** @internal Extracts a relevant excerpt around the first match of any query term. */
export function extractExcerpt(
  content: string,
  queryTerms: string[],
  maxLength = 500,
): string {
  const lower = content.toLowerCase();
  let earliestIndex = -1;

  for (const term of queryTerms) {
    const idx = lower.indexOf(term);
    if (idx !== -1 && (earliestIndex === -1 || idx < earliestIndex)) {
      earliestIndex = idx;
    }
  }

  if (earliestIndex === -1) {
    return content.slice(0, maxLength);
  }

  const start = Math.max(0, earliestIndex - 100);
  const end = Math.min(content.length, start + maxLength);
  let excerpt = content.slice(start, end);

  if (start > 0) excerpt = '...' + excerpt;
  if (end < content.length) excerpt = excerpt + '...';

  return excerpt;
}

/**
 * Creates and starts the DataQueue MCP server over stdio.
 *
 * @param deps - Injectable dependencies for testing.
 */
export async function startMcpServer(
  deps: {
    docsPath?: string;
    transport?: InstanceType<typeof StdioServerTransport>;
  } = {},
): Promise<McpServer> {
  const pages = loadDocsContent(deps.docsPath);

  const server = new McpServer({
    name: 'dataqueue-docs',
    version: '1.0.0',
  });

  server.resource('llms-txt', 'dataqueue://llms.txt', async () => {
    const llmsPath = path.join(
      __dirname,
      '../ai/skills/dataqueue-core/SKILL.md',
    );
    let content: string;
    try {
      content = fs.readFileSync(llmsPath, 'utf-8');
    } catch {
      content = pages
        .map((p) => `## ${p.title}\n\nSlug: ${p.slug}\n\n${p.description}`)
        .join('\n\n');
    }
    return { contents: [{ uri: 'dataqueue://llms.txt', text: content }] };
  });

  server.tool(
    'list-doc-pages',
    'List all available DataQueue documentation pages with titles and descriptions.',
    {},
    async () => {
      const listing = pages.map((p) => ({
        slug: p.slug,
        title: p.title,
        description: p.description,
      }));
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(listing, null, 2) },
        ],
      };
    },
  );

  server.tool(
    'get-doc-page',
    'Fetch a specific DataQueue doc page by slug. Returns full page content as markdown.',
    {
      slug: z
        .string()
        .describe('The doc page slug, e.g. "usage/add-job" or "api/job-queue"'),
    },
    async ({ slug }) => {
      const page = pages.find((p) => p.slug === slug);
      if (!page) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Page not found: "${slug}". Use list-doc-pages to see available slugs.`,
            },
          ],
          isError: true,
        };
      }
      const header = page.description
        ? `# ${page.title}\n\n> ${page.description}\n\n`
        : `# ${page.title}\n\n`;
      return {
        content: [{ type: 'text' as const, text: header + page.content }],
      };
    },
  );

  server.tool(
    'search-docs',
    'Full-text search across all DataQueue documentation pages. Returns matching sections with page titles and content excerpts.',
    {
      query: z
        .string()
        .describe('Search query, e.g. "cron scheduling" or "waitForToken"'),
    },
    async ({ query }) => {
      const queryTerms = query
        .toLowerCase()
        .split(/\s+/)
        .filter((t) => t.length > 1);

      if (queryTerms.length === 0) {
        return {
          content: [
            { type: 'text' as const, text: 'Please provide a search query.' },
          ],
          isError: true,
        };
      }

      const scored = pages
        .map((page) => ({
          page,
          score: scorePageForQuery(page, queryTerms),
        }))
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5);

      if (scored.length === 0) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `No results for "${query}". Try different keywords or use list-doc-pages to browse.`,
            },
          ],
        };
      }

      const results = scored.map((r) => {
        const excerpt = extractExcerpt(r.page.content, queryTerms);
        return `## ${r.page.title} (${r.page.slug})\n\n${r.page.description}\n\n${excerpt}`;
      });

      return {
        content: [{ type: 'text' as const, text: results.join('\n\n---\n\n') }],
      };
    },
  );

  const transport = deps.transport ?? new StdioServerTransport();
  await server.connect(transport);
  return server;
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('/mcp-server.js') ||
    process.argv[1].endsWith('/mcp-server.cjs'));

if (isDirectRun) {
  startMcpServer().catch((err) => {
    console.error('Failed to start MCP server:', err);
    process.exit(1);
  });
}
