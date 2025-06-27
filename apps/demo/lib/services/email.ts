export const sendEmail = async (to: string, subject: string, body: string) => {
  await new Promise((resolve) => setTimeout(resolve, 10000));
  console.log(
    `Sending email to ${to} with subject ${subject} and body ${body}`,
  );
};
