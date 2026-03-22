import type { DatabaseClient } from './types.js';
import type { JobDependsOn } from './types.js';

/**
 * Returns a negative placeholder id for `addJobs` batch ordering: `-(index + 1)`.
 * Resolves to the id of the job at `batchIndex` in the same batch after inserts.
 *
 * @param batchIndex - Zero-based index into the `addJobs` array.
 */
export function batchDepRef(batchIndex: number): number {
  if (!Number.isInteger(batchIndex) || batchIndex < 0) {
    throw new Error(
      `batchDepRef: expected non-negative integer index, got ${batchIndex}`,
    );
  }
  return -(batchIndex + 1);
}

/**
 * Normalizes optional `dependsOn`: empty arrays become undefined, ids de-duplicated.
 *
 * @param dep - Raw dependency options from the caller.
 */
export function normalizeDependsOn(dep?: JobDependsOn): {
  jobIds: number[] | undefined;
  tags: string[] | undefined;
} {
  if (!dep) return { jobIds: undefined, tags: undefined };
  const jobIds =
    dep.jobIds && dep.jobIds.length > 0 ? [...new Set(dep.jobIds)] : undefined;
  const tags =
    dep.tags && dep.tags.length > 0 ? [...new Set(dep.tags)] : undefined;
  return { jobIds, tags };
}

/**
 * Resolves batch-relative negative ids to real job ids after partial batch inserts.
 *
 * @param jobIds - May contain negative placeholders from {@link batchDepRef}.
 * @param insertedIds - Ids inserted so far, index-aligned with the batch array prefix.
 */
export function resolveDependsOnJobIdsForBatch(
  jobIds: number[],
  insertedIds: number[],
): number[] {
  return jobIds.map((id) => {
    if (id >= 0) return id;
    const idx = -id - 1;
    if (idx < 0 || idx >= insertedIds.length) {
      throw new Error(
        `Invalid batch-relative job id ${id}: index ${idx} out of range for ${insertedIds.length} inserted job(s)`,
      );
    }
    return insertedIds[idx]!;
  });
}

/**
 * Returns true if `holderTags` contains every tag in `requiredTags` (set inclusion).
 *
 * @param holderTags - Tags on job X.
 * @param requiredTags - `depends_on_tags` on dependent D.
 */
export function tagsAreSuperset(
  holderTags: string[] | null | undefined,
  requiredTags: string[] | null | undefined,
): boolean {
  if (!requiredTags || requiredTags.length === 0) return false;
  if (!holderTags || holderTags.length === 0) return false;
  const set = new Set(holderTags);
  for (const t of requiredTags) {
    if (!set.has(t)) return false;
  }
  return true;
}

/**
 * Throws if inserting a job with `dependsOnJobIds` would create a cycle.
 * Uses: jobs reachable downstream from `newJobId` must not include any prerequisite id
 * (equivalently: a prerequisite must not lie in the downstream closure of `newJobId`).
 *
 * @param client - DB client (transaction).
 * @param newJobId - Id of the row just inserted.
 * @param dependsOnJobIds - Resolved positive prerequisite ids.
 */
/**
 * Ensures every id in `jobIds` exists in `job_queue`.
 *
 * @param client - Database client.
 * @param jobIds - Resolved positive job ids.
 */
export async function validatePrerequisiteJobIdsExist(
  client: DatabaseClient,
  jobIds: number[],
): Promise<void> {
  if (jobIds.length === 0) return;
  const r = await client.query(
    `SELECT COUNT(*)::int AS c FROM job_queue WHERE id = ANY($1::int[])`,
    [jobIds],
  );
  const c = r.rows[0]?.c ?? 0;
  if (c !== jobIds.length) {
    throw new Error(
      `dependsOn.jobIds: one or more job ids do not exist (${jobIds.join(', ')})`,
    );
  }
}

export async function assertNoDependencyCycle(
  client: DatabaseClient,
  newJobId: number,
  dependsOnJobIds: number[],
): Promise<void> {
  if (dependsOnJobIds.length === 0) return;
  if (dependsOnJobIds.includes(newJobId)) {
    throw new Error(
      `Job ${newJobId} cannot depend on itself (dependsOn.jobIds)`,
    );
  }
  const result = await client.query(
    `
    WITH RECURSIVE downstream AS (
      SELECT j.id
      FROM job_queue j
      WHERE j.depends_on_job_ids @> ARRAY[$1::integer]::integer[]
      UNION
      SELECT j.id
      FROM job_queue j
      INNER JOIN downstream d ON j.depends_on_job_ids @> ARRAY[d.id]::integer[]
    )
    SELECT 1 FROM downstream WHERE id = ANY($2::integer[]) LIMIT 1
    `,
    [newJobId, dependsOnJobIds],
  );
  if (result.rows.length > 0) {
    throw new Error(
      `Adding job ${newJobId} would create a dependency cycle (dependsOn.jobIds)`,
    );
  }
}
