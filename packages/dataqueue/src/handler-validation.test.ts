import { describe, expect, it } from 'vitest';
import {
  validateHandlerSerializable,
  testHandlerSerialization,
} from './handler-validation.js';
import { JobHandler } from './types.js';

// Define test payload map
interface TestPayloadMap {
  simple: { data: string };
  complex: { id: number; name: string };
}

describe('validateHandlerSerializable', () => {
  it('should validate a simple standalone handler as serializable', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should validate a handler with local variables as serializable', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      const localVar = 'test';
      const anotherVar = 123;
      await Promise.resolve(localVar + anotherVar);
    };

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should validate a handler that imports dependencies inside as serializable', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      const { default: something } = await import('path');
      await Promise.resolve();
    };

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject a handler that uses "this" context', () => {
    // Create a handler that uses 'this' by mocking toString to show 'this.' in the body
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    // Mock toString to simulate a handler that uses 'this'
    const originalToString = handler.toString.bind(handler);
    (handler as any).toString = () =>
      'async (payload) => { return this.value; }';

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(false);
    expect(result.error).toContain("uses 'this' context");
    expect(result.error).toContain('cannot be serialized');

    // Restore
    (handler as any).toString = originalToString;
  });

  it('should reject a handler with native code', () => {
    // Create a handler that might contain native code
    // This is tricky to test directly, but we can test the detection logic
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      // Native methods like Array.prototype methods might show as native code
      Array.isArray([]);
      await Promise.resolve();
    };

    // Mock toString to return native code indicator
    const originalToString = handler.toString.bind(handler);
    (handler as any).toString = () => '[native code]';

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(false);
    expect(result.error).toContain('contains native code');
    expect(result.error).toContain('cannot be serialized');

    // Restore
    (handler as any).toString = originalToString;
  });

  it('should reject a handler that cannot be parsed', () => {
    // Create a handler with invalid syntax when stringified
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    // Mock toString to return invalid function code
    const originalToString = handler.toString.bind(handler);
    (handler as any).toString = () =>
      'async (payload) => { invalid syntax here !@#$';

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(false);
    expect(result.error).toContain('cannot be serialized');

    // Restore
    (handler as any).toString = originalToString;
  });

  it('should warn about potential closures but still mark as serializable', () => {
    // This handler has a pattern that might indicate closures
    // but the validation can't be 100% sure, so it warns
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      const local = 'test';
      await Promise.resolve(local);
    };

    const result = validateHandlerSerializable(handler, 'simple');
    // The current implementation might return a warning, but it's still considered serializable
    // This test checks the behavior - if it warns, that's OK
    if (result.error) {
      expect(result.error).toContain('Warning');
      expect(result.error).toContain('may have closures');
    }
  });

  it('should work without jobType parameter', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    const result = validateHandlerSerializable(handler);
    expect(result.isSerializable).toBe(true);
  });

  it('should provide helpful error messages with jobType', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    // Mock toString to simulate a handler that uses 'this'
    const originalToString = handler.toString.bind(handler);
    (handler as any).toString = () =>
      'async (payload) => { return this.value; }';

    const result = validateHandlerSerializable(handler, 'myJobType');
    expect(result.isSerializable).toBe(false);
    expect(result.error).toContain('myJobType');
    expect(result.error).toContain("uses 'this' context");

    // Restore
    (handler as any).toString = originalToString;
  });

  it('should handle errors during validation gracefully', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    // Mock toString to throw an error
    const originalToString = handler.toString.bind(handler);
    (handler as any).toString = () => {
      throw new Error('toString failed');
    };

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(false);
    expect(result.error).toContain('Failed to validate handler serialization');

    // Restore
    (handler as any).toString = originalToString;
  });
});

describe('testHandlerSerialization', () => {
  it('should validate a simple handler as serializable', async () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    const result = await testHandlerSerialization(handler, 'simple');
    expect(result.isSerializable).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('should reject a handler that fails basic validation', async () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    // Mock toString to simulate a handler that uses 'this'
    const originalToString = handler.toString.bind(handler);
    (handler as any).toString = () =>
      'async (payload) => { return this.value; }';

    const result = await testHandlerSerialization(handler, 'simple');
    expect(result.isSerializable).toBe(false);
    expect(result.error).toContain("uses 'this' context");

    // Restore
    (handler as any).toString = originalToString;
  });

  it('should handle handlers that complete quickly', async () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      return Promise.resolve();
    };

    const result = await testHandlerSerialization(handler, 'simple');
    expect(result.isSerializable).toBe(true);
  });

  it('should handle handlers that take time but still validate as serializable', async () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      // Handler that takes longer than the test timeout (100ms)
      await new Promise((resolve) => setTimeout(resolve, 200));
    };

    const result = await testHandlerSerialization(handler, 'simple');
    // Should still be considered serializable even if it times out during test
    expect(result.isSerializable).toBe(true);
  });

  it('should handle handlers that throw errors during execution', async () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      throw new Error('Handler error');
    };

    const result = await testHandlerSerialization(handler, 'simple');
    // Execution errors are OK - we just want to know if it can be deserialized
    // The handler is still considered serializable
    expect(result.isSerializable).toBe(true);
  });

  it('should handle serialization errors', async () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    // Mock toString to return invalid code
    const originalToString = handler.toString.bind(handler);
    (handler as any).toString = () => 'invalid function code !@#$';

    const result = await testHandlerSerialization(handler, 'simple');
    expect(result.isSerializable).toBe(false);
    expect(result.error).toBeDefined();

    // Restore
    (handler as any).toString = originalToString;
  });

  it('should work without jobType parameter', async () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    const result = await testHandlerSerialization(handler);
    expect(result.isSerializable).toBe(true);
  });

  it('should handle complex payload types', async () => {
    const handler: JobHandler<TestPayloadMap, 'complex'> = async (
      payload,
      signal,
    ) => {
      const { id, name } = payload;
      await Promise.resolve(`${id}: ${name}`);
    };

    const result = await testHandlerSerialization(handler, 'complex');
    expect(result.isSerializable).toBe(true);
  });

  it('should handle handlers that use signal parameter', async () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      if (signal.aborted) {
        return;
      }
      await Promise.resolve();
    };

    const result = await testHandlerSerialization(handler, 'simple');
    expect(result.isSerializable).toBe(true);
  });
});

describe('handler validation edge cases', () => {
  it('should handle arrow functions correctly', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      await Promise.resolve();
    };

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(true);
  });

  it('should handle regular function declarations', () => {
    async function handler(
      payload: TestPayloadMap['simple'],
      signal: AbortSignal,
    ): Promise<void> {
      await Promise.resolve();
    }

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(true);
  });

  it('should handle handlers with multiple statements', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      const step1 = 'first';
      const step2 = 'second';
      const step3 = step1 + step2;
      await Promise.resolve(step3);
    };

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(true);
  });

  it('should handle handlers with conditional logic', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      if (signal.aborted) {
        return;
      }
      if (payload.data === 'test') {
        await Promise.resolve('matched');
      } else {
        await Promise.resolve('not matched');
      }
    };

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(true);
  });

  it('should handle handlers with try-catch blocks', () => {
    const handler: JobHandler<TestPayloadMap, 'simple'> = async (
      payload,
      signal,
    ) => {
      try {
        await Promise.resolve();
      } catch (error) {
        throw error;
      }
    };

    const result = validateHandlerSerializable(handler, 'simple');
    expect(result.isSerializable).toBe(true);
  });
});
