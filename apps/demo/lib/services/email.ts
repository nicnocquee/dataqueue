export const sendEmail = async (to: string, subject: string, body: string) => {
  console.log(
    `Sending email to ${to} with subject ${subject} and body ${body}`,
  );

  // Simulate email sending with a 10 second delay and a 50% chance of failure
  await new Promise((resolve, reject) =>
    setTimeout(() => {
      if (Math.random() > 0.5) {
        resolve(true);
      } else {
        reject(new Error('Email failed'));
      }
    }, 10000),
  );
};
