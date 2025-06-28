export const generateReport = async (reportId: string, userId: string) => {
  console.log(`Generating report for ${reportId} with user ${userId}`);

  // Simulate report generation with a 10 second delay and a 50% chance of failure
  await new Promise((resolve, reject) =>
    setTimeout(() => {
      if (Math.random() > 0.5) {
        resolve(true);
      } else {
        reject(new Error('Report generation failed'));
      }
    }, 10000),
  );
};
