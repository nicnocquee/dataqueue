import { describe, it, expect } from 'vitest';
import {
  loadDocsContent,
  scorePageForQuery,
  extractExcerpt,
} from './mcp-server.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_CONTENT_PATH = path.join(__dirname, '../ai/docs-content.json');

describe('loadDocsContent', () => {
  it('loads the docs-content.json file', () => {
    // Act
    const pages = loadDocsContent(DOCS_CONTENT_PATH);

    // Assert
    expect(pages.length).toBeGreaterThan(0);
    expect(pages[0]).toHaveProperty('slug');
    expect(pages[0]).toHaveProperty('title');
    expect(pages[0]).toHaveProperty('content');
  });

  it('throws for non-existent file', () => {
    // Act & Assert
    expect(() => loadDocsContent('/nonexistent/path.json')).toThrow();
  });
});

describe('scorePageForQuery', () => {
  it('scores title matches highest', () => {
    // Setup
    const page = {
      slug: 'test',
      title: 'Cron Jobs',
      description: 'Schedule recurring tasks',
      content: 'Use cron expressions.',
    };

    // Act
    const score = scorePageForQuery(page, ['cron']);

    // Assert
    expect(score).toBeGreaterThanOrEqual(10);
  });

  it('scores description matches', () => {
    // Setup
    const page = {
      slug: 'test',
      title: 'Other Page',
      description: 'Schedule recurring cron tasks',
      content: 'No match in content.',
    };

    // Act
    const score = scorePageForQuery(page, ['cron']);

    // Assert
    expect(score).toBeGreaterThanOrEqual(5);
  });

  it('scores content matches', () => {
    // Setup
    const page = {
      slug: 'test',
      title: 'Other',
      description: 'Other',
      content: 'Use cron for scheduling. Cron is powerful.',
    };

    // Act
    const score = scorePageForQuery(page, ['cron']);

    // Assert
    expect(score).toBeGreaterThan(0);
  });

  it('returns 0 for no matches', () => {
    // Setup
    const page = {
      slug: 'test',
      title: 'Unrelated',
      description: 'Nothing here',
      content: 'No match.',
    };

    // Act
    const score = scorePageForQuery(page, ['zzzzzzz']);

    // Assert
    expect(score).toBe(0);
  });

  it('handles multiple query terms', () => {
    // Setup
    const page = {
      slug: 'test',
      title: 'Cron Jobs',
      description: 'Schedule tasks',
      content: 'timeout and cron are related.',
    };

    // Act
    const scoreMulti = scorePageForQuery(page, ['cron', 'timeout']);
    const scoreSingle = scorePageForQuery(page, ['cron']);

    // Assert
    expect(scoreMulti).toBeGreaterThan(scoreSingle);
  });
});

describe('extractExcerpt', () => {
  it('extracts content around the first matching term', () => {
    // Setup
    const content = 'A'.repeat(200) + 'target keyword here' + 'B'.repeat(200);

    // Act
    const excerpt = extractExcerpt(content, ['target']);

    // Assert
    expect(excerpt).toContain('target keyword here');
    expect(excerpt.length).toBeLessThanOrEqual(510);
  });

  it('returns beginning of content when no match found', () => {
    // Setup
    const content = 'This is the beginning of the content. More content here.';

    // Act
    const excerpt = extractExcerpt(content, ['nonexistent']);

    // Assert
    expect(excerpt).toBe(content);
  });

  it('adds ellipsis when excerpt is truncated', () => {
    // Setup
    const content = 'A'.repeat(300) + 'match' + 'B'.repeat(300);

    // Act
    const excerpt = extractExcerpt(content, ['match'], 200);

    // Assert
    expect(excerpt.startsWith('...')).toBe(true);
    expect(excerpt.endsWith('...')).toBe(true);
  });

  it('respects maxLength parameter', () => {
    // Setup
    const content = 'A'.repeat(1000);

    // Act
    const excerpt = extractExcerpt(content, ['nonexistent'], 100);

    // Assert
    expect(excerpt.length).toBeLessThanOrEqual(100);
  });
});
