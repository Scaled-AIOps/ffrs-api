export interface Mail { to: string; subject: string; text: string; html: string }
export type Mailer = (mail: Mail) => Promise<void>;

/** SES v2 mailer. Client SDK is provided by the Lambda runtime. */
export function sesMailer(from: string): Mailer {
  let client: import('@aws-sdk/client-sesv2').SESv2Client | undefined;
  return async ({ to, subject, text, html }) => {
    const { SESv2Client, SendEmailCommand } = await import('@aws-sdk/client-sesv2');
    client ??= new SESv2Client({});
    await client.send(new SendEmailCommand({
      FromEmailAddress: from,
      Destination: { ToAddresses: [to] },
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: text }, Html: { Data: html } } } },
    }));
  };
}
