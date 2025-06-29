/**
 * This is a mock implementation of the image generation service.
 * It simulates a long-running task that can be aborted.
 * @param prompt - The prompt to generate an image for
 * @param signal - The abort signal to cancel the task
 */
export const generateImageAi = async (prompt: string, signal: AbortSignal) => {
  console.log('Generating image with prompt:', prompt);
  await new Promise(
    (resolve) => setTimeout(resolve, Math.random() * 1000 + 8000), // 1000 to 9000 ms
  );

  if (signal.aborted) {
    console.log('Image generation aborted');
    return;
  }

  if (Math.random() < 0.5) {
    console.log('Image generation failed');
    throw new Error('Image generation failed');
  }

  console.log('Image generated');
};
