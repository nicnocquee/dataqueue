import { JobHandler } from './types.js';

/**
 * Validates that a job handler can be serialized for use with forceKillOnTimeout.
 *
 * This function checks if a handler can be safely serialized and executed in a worker thread.
 * Use this function during development to catch serialization issues early.
 *
 * @param handler - The job handler function to validate
 * @param jobType - Optional job type name for better error messages
 * @returns An object with `isSerializable` boolean and optional `error` message
 *
 * @example
 * ```ts
 * const handler = async (payload, signal) => {
 *   await doSomething(payload);
 * };
 *
 * const result = validateHandlerSerializable(handler, 'myJob');
 * if (!result.isSerializable) {
 *   console.error('Handler is not serializable:', result.error);
 * }
 * ```
 */
export function validateHandlerSerializable<
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  handler: JobHandler<PayloadMap, T>,
  jobType?: string,
): { isSerializable: boolean; error?: string } {
  try {
    const handlerString = handler.toString();
    const typeLabel = jobType ? `job type "${jobType}"` : 'handler';

    // Check for common patterns that indicate non-serializable handlers
    // 1. Arrow functions that capture 'this' (indicated by 'this' in the function body but not in parameters)
    if (
      handlerString.includes('this.') &&
      !handlerString.match(/\([^)]*this[^)]*\)/)
    ) {
      return {
        isSerializable: false,
        error:
          `Handler for ${typeLabel} uses 'this' context which cannot be serialized. ` +
          `Use a regular function or avoid 'this' references when forceKillOnTimeout is enabled.`,
      };
    }

    // 2. Check if handler string looks like it might have closures
    // This is a heuristic - we can't perfectly detect closures, but we can warn about common patterns
    if (handlerString.includes('[native code]')) {
      return {
        isSerializable: false,
        error:
          `Handler for ${typeLabel} contains native code which cannot be serialized. ` +
          `Ensure your handler is a plain function when forceKillOnTimeout is enabled.`,
      };
    }

    // 3. Try to create a function from the string to validate it's parseable
    // This will catch syntax errors early
    try {
      new Function('return ' + handlerString);
    } catch (parseError) {
      return {
        isSerializable: false,
        error:
          `Handler for ${typeLabel} cannot be serialized: ${parseError instanceof Error ? parseError.message : String(parseError)}. ` +
          `When using forceKillOnTimeout, handlers must be serializable functions without closures over external variables.`,
      };
    }

    // 4. Check for common closure patterns (heuristic)
    // Look for variable references that might be from outer scope
    // This is not perfect but can catch some common issues
    const hasPotentialClosure =
      /const\s+\w+\s*=\s*[^;]+;\s*async\s*\(/.test(handlerString) ||
      /let\s+\w+\s*=\s*[^;]+;\s*async\s*\(/.test(handlerString);

    if (hasPotentialClosure) {
      // This is just a warning, not a hard error, since we can't be 100% sure
      // The actual serialization will fail at runtime if there's a real issue
      return {
        isSerializable: true, // Still serializable, but might have issues
        error:
          `Warning: Handler for ${typeLabel} may have closures over external variables. ` +
          `Test thoroughly with forceKillOnTimeout enabled. If the handler fails to execute in a worker thread, ` +
          `ensure all dependencies are imported within the handler function.`,
      };
    }

    return { isSerializable: true };
  } catch (error) {
    return {
      isSerializable: false,
      error: `Failed to validate handler serialization${jobType ? ` for job type "${jobType}"` : ''}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Test if a handler can be serialized and executed in a worker thread.
 * This is a more thorough check that actually attempts to serialize and deserialize the handler.
 *
 * @param handler - The job handler function to test
 * @param jobType - Optional job type name for better error messages
 * @returns Promise that resolves to validation result
 *
 * @example
 * ```ts
 * const handler = async (payload, signal) => {
 *   await doSomething(payload);
 * };
 *
 * const result = await testHandlerSerialization(handler, 'myJob');
 * if (!result.isSerializable) {
 *   console.error('Handler failed serialization test:', result.error);
 * }
 * ```
 */
export async function testHandlerSerialization<
  PayloadMap,
  T extends keyof PayloadMap & string,
>(
  handler: JobHandler<PayloadMap, T>,
  jobType?: string,
): Promise<{ isSerializable: boolean; error?: string }> {
  // First do the basic validation
  const basicValidation = validateHandlerSerializable(handler, jobType);
  if (!basicValidation.isSerializable) {
    return basicValidation;
  }

  // Then try to actually serialize and deserialize in a worker-like context
  try {
    const handlerString = handler.toString();
    const handlerFn = new Function('return ' + handlerString)();

    // Try to call it with dummy parameters to see if it executes
    // We use a very short timeout to avoid hanging
    const testPromise = handlerFn({}, new AbortController().signal);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Handler test timeout')), 100),
    );

    try {
      await Promise.race([testPromise, timeoutPromise]);
    } catch (execError) {
      // Execution errors are OK - we just want to know if it can be deserialized
      // The actual job execution will handle real errors
      if (
        execError instanceof Error &&
        execError.message === 'Handler test timeout'
      ) {
        // Handler is taking too long, but that's OK for serialization test
        return { isSerializable: true };
      }
    }

    return { isSerializable: true };
  } catch (error) {
    return {
      isSerializable: false,
      error: `Handler failed serialization test: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
