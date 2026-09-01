import twilio from "twilio";

/**
 * Send an SMS with the order tracking link. The client is built lazily so a
 * missing Twilio config never breaks module import.
 *
 * Returns null when Twilio is not configured — local development and CI have
 * no credentials, and an unsent text must not fail a paid order.
 */
export async function sendTrackingSms(to: string, trackingUrl: string) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    console.warn("twilio: not configured, skipping tracking SMS");
    return null;
  }

  const client = twilio(accountSid, authToken);
  return client.messages.create({
    to,
    from,
    body: `Your ZenoEats order is confirmed! Track it live here: ${trackingUrl}`,
  });
}
