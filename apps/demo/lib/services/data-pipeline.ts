/**
 * Mock data pipeline service demonstrating multi-step processing.
 * Each step simulates a delay and returns data for the next step.
 */

export async function fetchData(
  source: string,
): Promise<{ rows: number; source: string }> {
  console.log(`[data_pipeline] Fetching data from: ${source}`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const rows = Math.floor(Math.random() * 900) + 100;
  console.log(`[data_pipeline] Fetched ${rows} rows from ${source}`);
  return { rows, source };
}

export async function transformData(data: {
  rows: number;
  source: string;
}): Promise<{ rows: number; transformed: boolean; source: string }> {
  console.log(
    `[data_pipeline] Transforming ${data.rows} rows from ${data.source}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(`[data_pipeline] Transformation complete`);
  return { ...data, transformed: true };
}

export async function loadData(
  data: { rows: number; transformed: boolean; source: string },
  destination: string,
): Promise<void> {
  console.log(`[data_pipeline] Loading ${data.rows} rows to: ${destination}`);
  await new Promise((resolve) => setTimeout(resolve, 2000));
  console.log(
    `[data_pipeline] Successfully loaded ${data.rows} rows to ${destination}`,
  );
}
