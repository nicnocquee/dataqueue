import { describe, it, expect, vi } from 'vitest';
import {
  assertNoDependencyCycle,
  batchDepRef,
  normalizeDependsOn,
  resolveDependsOnJobIdsForBatch,
  tagsAreSuperset,
  validatePrerequisiteJobIdsExist,
} from './job-dependencies.js';
import type { DatabaseClient } from './types.js';

describe('batchDepRef', () => {
  it('returns negative index encoding', () => {
    expect(batchDepRef(0)).toBe(-1);
    expect(batchDepRef(2)).toBe(-3);
  });

  it('throws on invalid index', () => {
    expect(() => batchDepRef(-1)).toThrow();
    expect(() => batchDepRef(1.5)).toThrow();
  });
});

describe('normalizeDependsOn', () => {
  it('returns undefined for empty input', () => {
    expect(normalizeDependsOn(undefined)).toEqual({
      jobIds: undefined,
      tags: undefined,
    });
  });

  it('deduplicates and drops empty', () => {
    expect(
      normalizeDependsOn({ jobIds: [1, 1, 2], tags: ['a', 'a', 'b'] }),
    ).toEqual({
      jobIds: [1, 2],
      tags: ['a', 'b'],
    });
  });
});

describe('resolveDependsOnJobIdsForBatch', () => {
  it('resolves negative placeholders', () => {
    expect(resolveDependsOnJobIdsForBatch([-1, -2], [10, 20])).toEqual([
      10, 20,
    ]);
  });

  it('passes through positive ids', () => {
    expect(resolveDependsOnJobIdsForBatch([5, -1], [99])).toEqual([5, 99]);
  });

  it('throws when index out of range', () => {
    expect(() => resolveDependsOnJobIdsForBatch([-3], [1, 2])).toThrow();
  });
});

describe('tagsAreSuperset', () => {
  it('returns false for empty required', () => {
    expect(tagsAreSuperset(['a'], [])).toBe(false);
  });

  it('checks inclusion', () => {
    expect(tagsAreSuperset(['a', 'b'], ['a'])).toBe(true);
    expect(tagsAreSuperset(['a'], ['a', 'b'])).toBe(false);
    expect(tagsAreSuperset(null, ['a'])).toBe(false);
  });
});

describe('validatePrerequisiteJobIdsExist', () => {
  it('no-ops for empty', async () => {
    const client: DatabaseClient = {
      query: vi.fn(),
    };
    await validatePrerequisiteJobIdsExist(client, []);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('throws when count mismatches', async () => {
    const client: DatabaseClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ c: 1 }], rowCount: 1 }),
    };
    await expect(
      validatePrerequisiteJobIdsExist(client, [1, 2]),
    ).rejects.toThrow(/do not exist/);
  });

  it('resolves when all exist', async () => {
    const client: DatabaseClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ c: 2 }], rowCount: 1 }),
    };
    await validatePrerequisiteJobIdsExist(client, [1, 2]);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});

describe('assertNoDependencyCycle', () => {
  it('throws on self-dependency', async () => {
    const client: DatabaseClient = { query: vi.fn() };
    await expect(assertNoDependencyCycle(client, 1, [1])).rejects.toThrow(
      /cannot depend on itself/,
    );
  });

  it('throws when cycle detected', async () => {
    const client: DatabaseClient = {
      query: vi
        .fn()
        .mockResolvedValue({ rows: [{ '?column?': 1 }], rowCount: 1 }),
    };
    await expect(assertNoDependencyCycle(client, 5, [1, 2])).rejects.toThrow(
      /cycle/,
    );
  });

  it('no-ops when no deps', async () => {
    const client: DatabaseClient = { query: vi.fn() };
    await assertNoDependencyCycle(client, 1, []);
    expect(client.query).not.toHaveBeenCalled();
  });

  it('no-ops when query returns no cycle', async () => {
    const client: DatabaseClient = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    await assertNoDependencyCycle(client, 5, [1]);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});
