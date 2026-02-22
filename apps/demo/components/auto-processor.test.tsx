import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { AutoProcessor } from './auto-processor';

describe('AutoProcessor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('renders the auto-processing indicator when idle', () => {
    // Setup
    const action = vi.fn().mockResolvedValue({});

    // Act
    render(<AutoProcessor action={action} />);

    // Assert
    expect(screen.getByText('Auto-processing')).toBeDefined();
  });

  it('calls the action on each interval tick', async () => {
    // Setup
    const action = vi.fn().mockResolvedValue({});

    // Act
    render(<AutoProcessor action={action} intervalMs={20_000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    // Assert
    expect(action).toHaveBeenCalledTimes(1);

    // Act - second tick
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    // Assert
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('does not call the action before the interval elapses', async () => {
    // Setup
    const action = vi.fn().mockResolvedValue({});

    // Act
    render(<AutoProcessor action={action} intervalMs={20_000} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });

    // Assert
    expect(action).not.toHaveBeenCalled();
  });

  it('skips a tick when the previous call is still in-flight', async () => {
    // Setup
    let resolveAction: () => void;
    const action = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveAction = resolve;
        }),
    );

    // Act
    render(<AutoProcessor action={action} intervalMs={1_000} />);

    // First tick - starts a call that won't resolve yet
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(action).toHaveBeenCalledTimes(1);

    // Second tick - action still in-flight, should be skipped
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(action).toHaveBeenCalledTimes(1);

    // Resolve the first call
    await act(async () => {
      resolveAction!();
      await vi.advanceTimersByTimeAsync(0);
    });

    // Third tick - should fire again now
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    // Assert
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('cleans up the interval on unmount', async () => {
    // Setup
    const action = vi.fn().mockResolvedValue({});

    // Act
    const { unmount } = render(
      <AutoProcessor action={action} intervalMs={1_000} />,
    );
    unmount();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    // Assert
    expect(action).not.toHaveBeenCalled();
  });

  it('forwards className to the root element', () => {
    // Setup
    const action = vi.fn().mockResolvedValue({});

    // Act
    const { container } = render(
      <AutoProcessor action={action} className="ml-auto" />,
    );

    // Assert
    expect(container.firstElementChild?.className).toContain('ml-auto');
  });

  it('uses the default 20s interval when none is provided', async () => {
    // Setup
    const action = vi.fn().mockResolvedValue({});

    // Act
    render(<AutoProcessor action={action} />);

    // Not fired at 19s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(19_999);
    });
    expect(action).not.toHaveBeenCalled();

    // Fires at 20s
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    // Assert
    expect(action).toHaveBeenCalledTimes(1);
  });
});
