export const generateReport = async (reportId: string, userId: string) => {
  await new Promise((resolve) => setTimeout(resolve, 10000));
  console.log(`Generating report for ${reportId} with user ${userId}`);
};
