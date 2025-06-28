## Filtering Jobs by Type

You can now configure the processor to only process jobs of a specific type (or types):

```ts
const processor = createProcessor(pool, { jobType: 'email' });
// Only jobs with job_type 'email' will be processed

const processorMulti = createProcessor(pool, { jobType: ['email', 'report'] });
// Only jobs with job_type 'email' or 'report' will be processed
```

You can also use the lower-level API:

```ts
await processBatch(pool, 'worker-1', 10, 'email'); // Only process 'email' jobs
await processBatch(pool, 'worker-2', 10, ['email', 'report']); // Only process 'email' and 'report' jobs
```

If jobType is omitted, all job types are processed (default behavior).
