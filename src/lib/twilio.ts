import twilio from "twilio";

/** Send an SMS with the order tracking link. Client is built lazily. */
export async function sendTrackingSms(to: string, trackingUrl: string) {
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );
  return client.messages.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER,
    body: `Your ZenoEats order is confirmed! Track it live here: ${trackingUrl}`,
  });
}
