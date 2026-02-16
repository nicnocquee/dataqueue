/**
 * Lua scripts for atomic Redis operations.
 *
 * Key naming convention (all prefixed with the configurable keyPrefix, default "dq:"):
 *   dq:id_seq              – INCR counter for auto-increment IDs
 *   dq:job:{id}            – Hash with all job fields
 *   dq:queue               – Sorted Set of ready-to-process job IDs (score = priority composite)
 *   dq:delayed             – Sorted Set of future-scheduled job IDs (score = run_at ms)
 *   dq:retry               – Sorted Set of retry-waiting job IDs (score = next_attempt_at ms)
 *   dq:status:{status}     – Set of job IDs per status
 *   dq:type:{jobType}      – Set of job IDs per type
 *   dq:tag:{tag}           – Set of job IDs per tag
 *   dq:job:{id}:tags       – Set of tags for a specific job
 *   dq:events:{id}         – List of JSON event objects
 *   dq:idempotency:{key}   – String mapping idempotency key → job ID
 *   dq:all                 – Sorted Set of all jobs (score = createdAt ms, for ordering)
 *   dq:event_id_seq        – INCR counter for event IDs
 */

// ─── Score helpers ──────────────────────────────────────────────────────
// For the ready queue we need: higher priority first, then earlier createdAt.
// Score = priority * 1e15 + (1e15 - createdAtMs)
// ZPOPMAX gives highest score → highest priority, earliest created.
const SCORE_RANGE = '1000000000000000'; // 1e15

/**
 * ADD JOB
 * KEYS: [prefix]
 * ARGV: [jobType, payloadJson, maxAttempts, priority, runAtMs, timeoutMs,
 *        forceKillOnTimeout, tagsJson, idempotencyKey, nowMs]
 * Returns: job ID (number)
 */
export const ADD_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobType = ARGV[1]
local payloadJson = ARGV[2]
local maxAttempts = tonumber(ARGV[3])
local priority = tonumber(ARGV[4])
local runAtMs = ARGV[5]  -- "0" means now
local timeoutMs = ARGV[6] -- "null" string if not set
local forceKillOnTimeout = ARGV[7]
local tagsJson = ARGV[8] -- "null" or JSON array string
local idempotencyKey = ARGV[9] -- "null" string if not set
local nowMs = tonumber(ARGV[10])

-- Idempotency check
if idempotencyKey ~= "null" then
  local existing = redis.call('GET', prefix .. 'idempotency:' .. idempotencyKey)
  if existing then
    return existing
  end
end

-- Generate ID
local id = redis.call('INCR', prefix .. 'id_seq')
local jobKey = prefix .. 'job:' .. id
local runAt = runAtMs ~= "0" and tonumber(runAtMs) or nowMs

-- Store the job hash
redis.call('HMSET', jobKey,
  'id', id,
  'jobType', jobType,
  'payload', payloadJson,
  'status', 'pending',
  'maxAttempts', maxAttempts,
  'attempts', 0,
  'priority', priority,
  'runAt', runAt,
  'timeoutMs', timeoutMs,
  'forceKillOnTimeout', forceKillOnTimeout,
  'createdAt', nowMs,
  'updatedAt', nowMs,
  'lockedAt', 'null',
  'lockedBy', 'null',
  'nextAttemptAt', 'null',
  'pendingReason', 'null',
  'errorHistory', '[]',
  'failureReason', 'null',
  'completedAt', 'null',
  'startedAt', 'null',
  'lastRetriedAt', 'null',
  'lastFailedAt', 'null',
  'lastCancelledAt', 'null',
  'tags', tagsJson,
  'idempotencyKey', idempotencyKey
)

-- Status index
redis.call('SADD', prefix .. 'status:pending', id)

-- Type index
redis.call('SADD', prefix .. 'type:' .. jobType, id)

-- Tag indexes
if tagsJson ~= "null" then
  local tags = cjson.decode(tagsJson)
  for _, tag in ipairs(tags) do
    redis.call('SADD', prefix .. 'tag:' .. tag, id)
  end
  -- Store tags for exact-match queries
  for _, tag in ipairs(tags) do
    redis.call('SADD', prefix .. 'job:' .. id .. ':tags', tag)
  end
end

-- Idempotency mapping
if idempotencyKey ~= "null" then
  redis.call('SET', prefix .. 'idempotency:' .. idempotencyKey, id)
end

-- All-jobs sorted set (for ordering by createdAt)
redis.call('ZADD', prefix .. 'all', nowMs, id)

-- Queue or delayed
if runAt <= nowMs then
  -- Ready now: add to queue with priority score
  local score = priority * ${SCORE_RANGE} + (${SCORE_RANGE} - nowMs)
  redis.call('ZADD', prefix .. 'queue', score, id)
else
  -- Future: add to delayed set
  redis.call('ZADD', prefix .. 'delayed', runAt, id)
end

return id
`;

/**
 * GET NEXT BATCH
 * Atomically: move ready delayed/retry jobs into queue, then pop N jobs.
 * KEYS: [prefix]
 * ARGV: [workerId, batchSize, nowMs, jobTypeFilter]
 * jobTypeFilter: "null" or a JSON array like ["email","sms"] or a string like "email"
 * Returns: array of job field arrays (flat: [field1, val1, field2, val2, ...] per job)
 */
export const GET_NEXT_BATCH_SCRIPT = `
local prefix = KEYS[1]
local workerId = ARGV[1]
local batchSize = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local jobTypeFilter = ARGV[4] -- "null" or JSON array or single string

-- 1. Move ready delayed jobs into queue
local delayed = redis.call('ZRANGEBYSCORE', prefix .. 'delayed', '-inf', nowMs, 'LIMIT', 0, 200)
for _, jobId in ipairs(delayed) do
  local jk = prefix .. 'job:' .. jobId
  local status = redis.call('HGET', jk, 'status')
  local attempts = tonumber(redis.call('HGET', jk, 'attempts'))
  local maxAttempts = tonumber(redis.call('HGET', jk, 'maxAttempts'))
  if status == 'pending' and attempts < maxAttempts then
    local pri = tonumber(redis.call('HGET', jk, 'priority') or '0')
    local ca = tonumber(redis.call('HGET', jk, 'createdAt'))
    local score = pri * ${SCORE_RANGE} + (${SCORE_RANGE} - ca)
    redis.call('ZADD', prefix .. 'queue', score, jobId)
  end
  redis.call('ZREM', prefix .. 'delayed', jobId)
end

-- 2. Move ready retry jobs into queue
local retries = redis.call('ZRANGEBYSCORE', prefix .. 'retry', '-inf', nowMs, 'LIMIT', 0, 200)
for _, jobId in ipairs(retries) do
  local jk = prefix .. 'job:' .. jobId
  local status = redis.call('HGET', jk, 'status')
  local attempts = tonumber(redis.call('HGET', jk, 'attempts'))
  local maxAttempts = tonumber(redis.call('HGET', jk, 'maxAttempts'))
  if status == 'failed' and attempts < maxAttempts then
    local pri = tonumber(redis.call('HGET', jk, 'priority') or '0')
    local ca = tonumber(redis.call('HGET', jk, 'createdAt'))
    local score = pri * ${SCORE_RANGE} + (${SCORE_RANGE} - ca)
    redis.call('ZADD', prefix .. 'queue', score, jobId)
    redis.call('SREM', prefix .. 'status:failed', jobId)
    redis.call('SADD', prefix .. 'status:pending', jobId)
    redis.call('HMSET', jk, 'status', 'pending')
  end
  redis.call('ZREM', prefix .. 'retry', jobId)
end

-- 3. Parse job type filter
local filterTypes = nil
if jobTypeFilter ~= "null" then
  -- Could be a JSON array or a plain string
  local ok, decoded = pcall(cjson.decode, jobTypeFilter)
  if ok and type(decoded) == 'table' then
    filterTypes = {}
    for _, t in ipairs(decoded) do filterTypes[t] = true end
  else
    filterTypes = { [jobTypeFilter] = true }
  end
end

-- 4. Pop candidates from queue (highest score first)
-- We pop more than batchSize because some may be filtered out
local popCount = batchSize * 3
local candidates = redis.call('ZPOPMAX', prefix .. 'queue', popCount)
-- candidates: [member1, score1, member2, score2, ...]

local results = {}
local jobsClaimed = 0
local putBack = {}   -- {score, id} pairs to put back

for i = 1, #candidates, 2 do
  local jobId = candidates[i]
  local score = candidates[i + 1]
  local jk = prefix .. 'job:' .. jobId

  if jobsClaimed >= batchSize then
    -- We have enough; put the rest back
    table.insert(putBack, score)
    table.insert(putBack, jobId)
  else
    -- Check job type filter
    local jt = redis.call('HGET', jk, 'jobType')
    if filterTypes and not filterTypes[jt] then
      -- Doesn't match filter: put back
      table.insert(putBack, score)
      table.insert(putBack, jobId)
    else
      -- Check run_at
      local runAt = tonumber(redis.call('HGET', jk, 'runAt'))
      if runAt > nowMs then
        -- Not ready yet: move to delayed
        redis.call('ZADD', prefix .. 'delayed', runAt, jobId)
      else
        -- Claim this job
        local attempts = tonumber(redis.call('HGET', jk, 'attempts'))
        local startedAt = redis.call('HGET', jk, 'startedAt')
        local lastRetriedAt = redis.call('HGET', jk, 'lastRetriedAt')
        if startedAt == 'null' then startedAt = nowMs end
        if attempts > 0 then lastRetriedAt = nowMs end

        redis.call('HMSET', jk,
          'status', 'processing',
          'lockedAt', nowMs,
          'lockedBy', workerId,
          'attempts', attempts + 1,
          'updatedAt', nowMs,
          'pendingReason', 'null',
          'startedAt', startedAt,
          'lastRetriedAt', lastRetriedAt
        )

        -- Update status sets
        redis.call('SREM', prefix .. 'status:pending', jobId)
        redis.call('SADD', prefix .. 'status:processing', jobId)

        -- Return job data as flat array
        local data = redis.call('HGETALL', jk)
        for _, v in ipairs(data) do
          table.insert(results, v)
        end
        -- Separator
        table.insert(results, '__JOB_SEP__')
        jobsClaimed = jobsClaimed + 1
      end
    end
  end
end

-- Put back jobs we didn't claim
if #putBack > 0 then
  redis.call('ZADD', prefix .. 'queue', unpack(putBack))
end

return results
`;

/**
 * COMPLETE JOB
 * KEYS: [prefix]
 * ARGV: [jobId, nowMs]
 */
export const COMPLETE_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobId = ARGV[1]
local nowMs = ARGV[2]
local jk = prefix .. 'job:' .. jobId

redis.call('HMSET', jk,
  'status', 'completed',
  'updatedAt', nowMs,
  'completedAt', nowMs
)
redis.call('SREM', prefix .. 'status:processing', jobId)
redis.call('SADD', prefix .. 'status:completed', jobId)

return 1
`;

/**
 * FAIL JOB
 * KEYS: [prefix]
 * ARGV: [jobId, errorJson, failureReason, nowMs]
 * errorJson: JSON array like [{"message":"...", "timestamp":"..."}]
 */
export const FAIL_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobId = ARGV[1]
local errorJson = ARGV[2]
local failureReason = ARGV[3]
local nowMs = tonumber(ARGV[4])
local jk = prefix .. 'job:' .. jobId

local attempts = tonumber(redis.call('HGET', jk, 'attempts'))
local maxAttempts = tonumber(redis.call('HGET', jk, 'maxAttempts'))

-- Compute next_attempt_at: 2^attempts minutes from now
local nextAttemptAt = 'null'
if attempts < maxAttempts then
  local delayMs = math.pow(2, attempts) * 60000
  nextAttemptAt = nowMs + delayMs
end

-- Append to error_history
local history = redis.call('HGET', jk, 'errorHistory') or '[]'
local ok, arr = pcall(cjson.decode, history)
if not ok then arr = {} end
local newErrors = cjson.decode(errorJson)
for _, e in ipairs(newErrors) do
  table.insert(arr, e)
end

redis.call('HMSET', jk,
  'status', 'failed',
  'updatedAt', nowMs,
  'nextAttemptAt', tostring(nextAttemptAt),
  'errorHistory', cjson.encode(arr),
  'failureReason', failureReason,
  'lastFailedAt', nowMs
)
redis.call('SREM', prefix .. 'status:processing', jobId)
redis.call('SADD', prefix .. 'status:failed', jobId)

-- Schedule retry if applicable
if nextAttemptAt ~= 'null' then
  redis.call('ZADD', prefix .. 'retry', nextAttemptAt, jobId)
end

return 1
`;

/**
 * RETRY JOB
 * KEYS: [prefix]
 * ARGV: [jobId, nowMs]
 */
export const RETRY_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local jk = prefix .. 'job:' .. jobId

local oldStatus = redis.call('HGET', jk, 'status')

redis.call('HMSET', jk,
  'status', 'pending',
  'updatedAt', nowMs,
  'lockedAt', 'null',
  'lockedBy', 'null',
  'nextAttemptAt', nowMs,
  'lastRetriedAt', nowMs
)

-- Remove from old status, add to pending
if oldStatus then
  redis.call('SREM', prefix .. 'status:' .. oldStatus, jobId)
end
redis.call('SADD', prefix .. 'status:pending', jobId)

-- Remove from retry sorted set if present
redis.call('ZREM', prefix .. 'retry', jobId)

-- Add to queue (ready now)
local priority = tonumber(redis.call('HGET', jk, 'priority') or '0')
local createdAt = tonumber(redis.call('HGET', jk, 'createdAt'))
local score = priority * ${SCORE_RANGE} + (${SCORE_RANGE} - createdAt)
redis.call('ZADD', prefix .. 'queue', score, jobId)

return 1
`;

/**
 * CANCEL JOB (only if pending)
 * KEYS: [prefix]
 * ARGV: [jobId, nowMs]
 */
export const CANCEL_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobId = ARGV[1]
local nowMs = ARGV[2]
local jk = prefix .. 'job:' .. jobId

local status = redis.call('HGET', jk, 'status')
if status ~= 'pending' then return 0 end

redis.call('HMSET', jk,
  'status', 'cancelled',
  'updatedAt', nowMs,
  'lastCancelledAt', nowMs
)
redis.call('SREM', prefix .. 'status:pending', jobId)
redis.call('SADD', prefix .. 'status:cancelled', jobId)
-- Remove from queue / delayed
redis.call('ZREM', prefix .. 'queue', jobId)
redis.call('ZREM', prefix .. 'delayed', jobId)

return 1
`;

/**
 * PROLONG JOB
 * KEYS: [prefix]
 * ARGV: [jobId, nowMs]
 */
export const PROLONG_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobId = ARGV[1]
local nowMs = ARGV[2]
local jk = prefix .. 'job:' .. jobId

local status = redis.call('HGET', jk, 'status')
if status ~= 'processing' then return 0 end

redis.call('HMSET', jk,
  'lockedAt', nowMs,
  'updatedAt', nowMs
)

return 1
`;

/**
 * RECLAIM STUCK JOBS
 * KEYS: [prefix]
 * ARGV: [maxAgeMs, nowMs]
 * Returns: count of reclaimed jobs
 */
export const RECLAIM_STUCK_JOBS_SCRIPT = `
local prefix = KEYS[1]
local maxAgeMs = tonumber(ARGV[1])
local nowMs = tonumber(ARGV[2])

local processing = redis.call('SMEMBERS', prefix .. 'status:processing')
local count = 0

for _, jobId in ipairs(processing) do
  local jk = prefix .. 'job:' .. jobId
  local lockedAt = redis.call('HGET', jk, 'lockedAt')
  if lockedAt and lockedAt ~= 'null' then
    local lockedAtNum = tonumber(lockedAt)
    if lockedAtNum then
      -- Use the greater of maxAgeMs and the job's own timeoutMs
      local jobMaxAge = maxAgeMs
      local timeoutMs = redis.call('HGET', jk, 'timeoutMs')
      if timeoutMs and timeoutMs ~= 'null' then
        local tMs = tonumber(timeoutMs)
        if tMs and tMs > jobMaxAge then
          jobMaxAge = tMs
        end
      end
      local cutoff = nowMs - jobMaxAge
      if lockedAtNum < cutoff then
        redis.call('HMSET', jk,
          'status', 'pending',
          'lockedAt', 'null',
          'lockedBy', 'null',
          'updatedAt', nowMs
        )
        redis.call('SREM', prefix .. 'status:processing', jobId)
        redis.call('SADD', prefix .. 'status:pending', jobId)

        -- Re-add to queue
        local priority = tonumber(redis.call('HGET', jk, 'priority') or '0')
        local createdAt = tonumber(redis.call('HGET', jk, 'createdAt'))
        local score = priority * ${SCORE_RANGE} + (${SCORE_RANGE} - createdAt)
        redis.call('ZADD', prefix .. 'queue', score, jobId)

        count = count + 1
      end
    end
  end
end

return count
`;

/**
 * CLEANUP OLD JOBS (batched)
 *
 * Processes a batch of candidate job IDs from the completed set, deleting
 * those whose updatedAt is older than the cutoff. This script is called
 * repeatedly from TypeScript with batches obtained via SSCAN to avoid
 * loading the entire completed set into memory at once.
 *
 * KEYS: [prefix]
 * ARGV: [cutoffMs, id1, id2, ...]
 * Returns: count of deleted jobs in this batch
 */
export const CLEANUP_OLD_JOBS_BATCH_SCRIPT = `
local prefix = KEYS[1]
local cutoffMs = tonumber(ARGV[1])
local count = 0

for i = 2, #ARGV do
  local jobId = ARGV[i]
  local jk = prefix .. 'job:' .. jobId
  local updatedAt = tonumber(redis.call('HGET', jk, 'updatedAt'))
  if updatedAt and updatedAt < cutoffMs then
    local jobType = redis.call('HGET', jk, 'jobType')
    local tagsJson = redis.call('HGET', jk, 'tags')
    local idempotencyKey = redis.call('HGET', jk, 'idempotencyKey')

    redis.call('DEL', jk)
    redis.call('SREM', prefix .. 'status:completed', jobId)
    redis.call('ZREM', prefix .. 'all', jobId)
    if jobType then
      redis.call('SREM', prefix .. 'type:' .. jobType, jobId)
    end
    if tagsJson and tagsJson ~= 'null' then
      local ok, tags = pcall(cjson.decode, tagsJson)
      if ok and type(tags) == 'table' then
        for _, tag in ipairs(tags) do
          redis.call('SREM', prefix .. 'tag:' .. tag, jobId)
        end
      end
      redis.call('DEL', prefix .. 'job:' .. jobId .. ':tags')
    end
    if idempotencyKey and idempotencyKey ~= 'null' then
      redis.call('DEL', prefix .. 'idempotency:' .. idempotencyKey)
    end
    redis.call('DEL', prefix .. 'events:' .. jobId)

    count = count + 1
  end
end

return count
`;
