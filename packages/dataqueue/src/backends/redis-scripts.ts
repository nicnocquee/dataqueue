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
 *   dq:waiting             – Sorted Set of time-based waiting job IDs (score = waitUntil ms)
 *   dq:waitpoint:{id}      – Hash with waitpoint fields (id, jobId, status, output, timeoutAt, etc.)
 *   dq:waitpoint_timeout   – Sorted Set of waitpoint IDs with timeouts (score = timeoutAt ms)
 *   dq:waitpoint_id_seq    – INCR counter for waitpoint sequence (used if needed)
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
 *        forceKillOnTimeout, tagsJson, idempotencyKey, nowMs,
 *        retryDelay, retryBackoff, retryDelayMax]
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
local retryDelay = ARGV[11]       -- "null" or seconds string
local retryBackoff = ARGV[12]     -- "null" or "true"/"false"
local retryDelayMax = ARGV[13]    -- "null" or seconds string

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
  'idempotencyKey', idempotencyKey,
  'waitUntil', 'null',
  'waitTokenId', 'null',
  'stepData', 'null',
  'retryDelay', retryDelay,
  'retryBackoff', retryBackoff,
  'retryDelayMax', retryDelayMax
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
 * ADD JOBS (batch)
 * KEYS: [prefix]
 * ARGV: [jobsJson, nowMs]
 *   jobsJson is a JSON array of objects, each with:
 *     jobType, payload (already JSON string), maxAttempts, priority,
 *     runAtMs, timeoutMs, forceKillOnTimeout, tags (JSON or "null"),
 *     idempotencyKey
 * Returns: array of job IDs (one per input job, in order)
 */
export const ADD_JOBS_SCRIPT = `
local prefix = KEYS[1]
local jobsJson = ARGV[1]
local nowMs = tonumber(ARGV[2])

local jobs = cjson.decode(jobsJson)
local results = {}

for i, job in ipairs(jobs) do
  local jobType = job.jobType
  local payloadJson = job.payload
  local maxAttempts = tonumber(job.maxAttempts)
  local priority = tonumber(job.priority)
  local runAtMs = tostring(job.runAtMs)
  local timeoutMs = tostring(job.timeoutMs)
  local forceKillOnTimeout = tostring(job.forceKillOnTimeout)
  local tagsJson = tostring(job.tags)
  local idempotencyKey = tostring(job.idempotencyKey)
  local retryDelay = tostring(job.retryDelay)
  local retryBackoff = tostring(job.retryBackoff)
  local retryDelayMax = tostring(job.retryDelayMax)

  -- Idempotency check
  local skip = false
  if idempotencyKey ~= "null" then
    local existing = redis.call('GET', prefix .. 'idempotency:' .. idempotencyKey)
    if existing then
      results[i] = tonumber(existing)
      skip = true
    end
  end

  if not skip then
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
      'idempotencyKey', idempotencyKey,
      'waitUntil', 'null',
      'waitTokenId', 'null',
      'stepData', 'null',
      'retryDelay', retryDelay,
      'retryBackoff', retryBackoff,
      'retryDelayMax', retryDelayMax
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
      for _, tag in ipairs(tags) do
        redis.call('SADD', prefix .. 'job:' .. id .. ':tags', tag)
      end
    end

    -- Idempotency mapping
    if idempotencyKey ~= "null" then
      redis.call('SET', prefix .. 'idempotency:' .. idempotencyKey, id)
    end

    -- All-jobs sorted set
    redis.call('ZADD', prefix .. 'all', nowMs, id)

    -- Queue or delayed
    if runAt <= nowMs then
      local score = priority * ${SCORE_RANGE} + (${SCORE_RANGE} - nowMs)
      redis.call('ZADD', prefix .. 'queue', score, id)
    else
      redis.call('ZADD', prefix .. 'delayed', runAt, id)
    end

    results[i] = id
  end
end

return results
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

-- 3. Move ready waiting jobs (time-based, no token) into queue
local waitingJobs = redis.call('ZRANGEBYSCORE', prefix .. 'waiting', '-inf', nowMs, 'LIMIT', 0, 200)
for _, jobId in ipairs(waitingJobs) do
  local jk = prefix .. 'job:' .. jobId
  local status = redis.call('HGET', jk, 'status')
  local waitTokenId = redis.call('HGET', jk, 'waitTokenId')
  if status == 'waiting' and (waitTokenId == false or waitTokenId == 'null') then
    local pri = tonumber(redis.call('HGET', jk, 'priority') or '0')
    local ca = tonumber(redis.call('HGET', jk, 'createdAt'))
    local score = pri * ${SCORE_RANGE} + (${SCORE_RANGE} - ca)
    redis.call('ZADD', prefix .. 'queue', score, jobId)
    redis.call('SREM', prefix .. 'status:waiting', jobId)
    redis.call('SADD', prefix .. 'status:pending', jobId)
    redis.call('HMSET', jk, 'status', 'pending', 'waitUntil', 'null')
  end
  redis.call('ZREM', prefix .. 'waiting', jobId)
end

-- 4. Parse job type filter
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

-- 5. Pop candidates from queue (highest score first)
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
 * ARGV: [jobId, nowMs, outputJson]
 */
export const COMPLETE_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobId = ARGV[1]
local nowMs = ARGV[2]
local outputJson = ARGV[3]
local jk = prefix .. 'job:' .. jobId

local fields = {
  'status', 'completed',
  'updatedAt', nowMs,
  'completedAt', nowMs,
  'stepData', 'null',
  'waitUntil', 'null',
  'waitTokenId', 'null'
}

if outputJson ~= '__NONE__' then
  fields[#fields + 1] = 'output'
  fields[#fields + 1] = outputJson
end

redis.call('HMSET', jk, unpack(fields))
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

-- Read per-job retry config (may be "null")
local rdRaw = redis.call('HGET', jk, 'retryDelay')
local rbRaw = redis.call('HGET', jk, 'retryBackoff')
local rmRaw = redis.call('HGET', jk, 'retryDelayMax')

local nextAttemptAt = 'null'
if attempts < maxAttempts then
  local allNull = (rdRaw == 'null' or rdRaw == false)
               and (rbRaw == 'null' or rbRaw == false)
               and (rmRaw == 'null' or rmRaw == false)
  if allNull then
    -- Legacy formula: 2^attempts minutes
    local delayMs = math.pow(2, attempts) * 60000
    nextAttemptAt = nowMs + delayMs
  else
    local retryDelaySec = 60
    if rdRaw and rdRaw ~= 'null' then retryDelaySec = tonumber(rdRaw) end
    local useBackoff = true
    if rbRaw and rbRaw ~= 'null' then useBackoff = (rbRaw == 'true') end
    local maxDelaySec = nil
    if rmRaw and rmRaw ~= 'null' then maxDelaySec = tonumber(rmRaw) end

    local delaySec
    if useBackoff then
      delaySec = retryDelaySec * math.pow(2, attempts)
      if maxDelaySec then delaySec = math.min(delaySec, maxDelaySec) end
      delaySec = delaySec * (0.5 + 0.5 * math.random())
    else
      delaySec = retryDelaySec
    end
    nextAttemptAt = nowMs + math.floor(delaySec * 1000)
  end
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
 * RETRY JOB (only if failed or processing)
 * KEYS: [prefix]
 * ARGV: [jobId, nowMs]
 */
export const RETRY_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobId = ARGV[1]
local nowMs = tonumber(ARGV[2])
local jk = prefix .. 'job:' .. jobId

local oldStatus = redis.call('HGET', jk, 'status')
if oldStatus ~= 'failed' and oldStatus ~= 'processing' then return 0 end

redis.call('HMSET', jk,
  'status', 'pending',
  'updatedAt', nowMs,
  'lockedAt', 'null',
  'lockedBy', 'null',
  'nextAttemptAt', nowMs,
  'lastRetriedAt', nowMs
)

-- Remove from old status, add to pending
redis.call('SREM', prefix .. 'status:' .. oldStatus, jobId)
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
 * CANCEL JOB (only if pending or waiting)
 * KEYS: [prefix]
 * ARGV: [jobId, nowMs]
 */
export const CANCEL_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobId = ARGV[1]
local nowMs = ARGV[2]
local jk = prefix .. 'job:' .. jobId

local status = redis.call('HGET', jk, 'status')
if status ~= 'pending' and status ~= 'waiting' then return 0 end

redis.call('HMSET', jk,
  'status', 'cancelled',
  'updatedAt', nowMs,
  'lastCancelledAt', nowMs,
  'waitUntil', 'null',
  'waitTokenId', 'null'
)
redis.call('SREM', prefix .. 'status:' .. status, jobId)
redis.call('SADD', prefix .. 'status:cancelled', jobId)
-- Remove from queue / delayed / waiting
redis.call('ZREM', prefix .. 'queue', jobId)
redis.call('ZREM', prefix .. 'delayed', jobId)
redis.call('ZREM', prefix .. 'waiting', jobId)

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

/**
 * WAIT JOB — Transition a job from 'processing' to 'waiting'.
 * KEYS: [prefix]
 * ARGV: [jobId, waitUntilMs, waitTokenId, stepDataJson, nowMs]
 * waitUntilMs: timestamp ms or "null"
 * waitTokenId: string or "null"
 * Returns: 1 if successful, 0 if job was not in 'processing' state
 */
export const WAIT_JOB_SCRIPT = `
local prefix = KEYS[1]
local jobId = ARGV[1]
local waitUntilMs = ARGV[2]
local waitTokenId = ARGV[3]
local stepDataJson = ARGV[4]
local nowMs = ARGV[5]
local jk = prefix .. 'job:' .. jobId

local status = redis.call('HGET', jk, 'status')
if status ~= 'processing' then return 0 end

redis.call('HMSET', jk,
  'status', 'waiting',
  'waitUntil', waitUntilMs,
  'waitTokenId', waitTokenId,
  'stepData', stepDataJson,
  'lockedAt', 'null',
  'lockedBy', 'null',
  'updatedAt', nowMs
)
redis.call('SREM', prefix .. 'status:processing', jobId)
redis.call('SADD', prefix .. 'status:waiting', jobId)

-- Add to waiting sorted set if time-based wait
if waitUntilMs ~= 'null' then
  redis.call('ZADD', prefix .. 'waiting', tonumber(waitUntilMs), jobId)
end

return 1
`;

/**
 * COMPLETE WAITPOINT — Mark a waitpoint as completed and resume associated job.
 * KEYS: [prefix]
 * ARGV: [tokenId, outputJson, nowMs]
 * outputJson: JSON string or "null"
 * Returns: 1 if successful, 0 if waitpoint not found or already completed
 */
export const COMPLETE_WAITPOINT_SCRIPT = `
local prefix = KEYS[1]
local tokenId = ARGV[1]
local outputJson = ARGV[2]
local nowMs = ARGV[3]
local wpk = prefix .. 'waitpoint:' .. tokenId

local wpStatus = redis.call('HGET', wpk, 'status')
if not wpStatus or wpStatus ~= 'waiting' then return 0 end

redis.call('HMSET', wpk,
  'status', 'completed',
  'output', outputJson,
  'completedAt', nowMs
)

-- Move associated job back to pending
local jobId = redis.call('HGET', wpk, 'jobId')
if jobId and jobId ~= 'null' then
  local jk = prefix .. 'job:' .. jobId
  local jobStatus = redis.call('HGET', jk, 'status')
  if jobStatus == 'waiting' then
    redis.call('HMSET', jk,
      'status', 'pending',
      'waitTokenId', 'null',
      'waitUntil', 'null',
      'updatedAt', nowMs
    )
    redis.call('SREM', prefix .. 'status:waiting', jobId)
    redis.call('SADD', prefix .. 'status:pending', jobId)
    redis.call('ZREM', prefix .. 'waiting', jobId)

    -- Re-add to queue
    local priority = tonumber(redis.call('HGET', jk, 'priority') or '0')
    local createdAt = tonumber(redis.call('HGET', jk, 'createdAt'))
    local score = priority * ${SCORE_RANGE} + (${SCORE_RANGE} - createdAt)
    redis.call('ZADD', prefix .. 'queue', score, jobId)
  end
end

return 1
`;

/**
 * EXPIRE TIMED OUT WAITPOINTS — Expire waitpoints past their timeout and resume jobs.
 * KEYS: [prefix]
 * ARGV: [nowMs]
 * Returns: count of expired waitpoints
 */
export const EXPIRE_TIMED_OUT_WAITPOINTS_SCRIPT = `
local prefix = KEYS[1]
local nowMs = tonumber(ARGV[1])

local expiredIds = redis.call('ZRANGEBYSCORE', prefix .. 'waitpoint_timeout', '-inf', nowMs)
local count = 0

for _, tokenId in ipairs(expiredIds) do
  local wpk = prefix .. 'waitpoint:' .. tokenId
  local wpStatus = redis.call('HGET', wpk, 'status')
  if wpStatus == 'waiting' then
    redis.call('HMSET', wpk,
      'status', 'timed_out'
    )

    -- Move associated job back to pending
    local jobId = redis.call('HGET', wpk, 'jobId')
    if jobId and jobId ~= 'null' then
      local jk = prefix .. 'job:' .. jobId
      local jobStatus = redis.call('HGET', jk, 'status')
      if jobStatus == 'waiting' then
        redis.call('HMSET', jk,
          'status', 'pending',
          'waitTokenId', 'null',
          'waitUntil', 'null',
          'updatedAt', nowMs
        )
        redis.call('SREM', prefix .. 'status:waiting', jobId)
        redis.call('SADD', prefix .. 'status:pending', jobId)
        redis.call('ZREM', prefix .. 'waiting', jobId)

        local priority = tonumber(redis.call('HGET', jk, 'priority') or '0')
        local createdAt = tonumber(redis.call('HGET', jk, 'createdAt'))
        local score = priority * ${SCORE_RANGE} + (${SCORE_RANGE} - createdAt)
        redis.call('ZADD', prefix .. 'queue', score, jobId)
      end
    end

    count = count + 1
  end
  redis.call('ZREM', prefix .. 'waitpoint_timeout', tokenId)
end

return count
`;
