import { describe, expect, it } from "vitest";
import { Webhook } from "svix";
import { verifyAgentMailEvent } from "./webhooks";

describe("AgentMail webhook verification", () => {
  const secret = `whsec_${btoa("benjamin-os-agentmail-test-secret-32")}`;
  const payload = JSON.stringify({ type: "event", event_type: "message.delivered", event_id: "evt_test", delivery: { message_id: "msg_test" } });
  const messageId = "msg_test_delivery";
  const timestamp = new Date();
  const signature = new Webhook(secret).sign(messageId, timestamp, payload);
  const headers = new Headers({ "svix-id": messageId, "svix-timestamp": String(Math.floor(timestamp.getTime() / 1_000)), "svix-signature": signature });

  it("accepts a valid signed AgentMail event", () => {
    expect(verifyAgentMailEvent(headers, payload, secret)?.event_type).toBe("message.delivered");
  });

  it("rejects tampered payloads and missing secrets", () => {
    expect(verifyAgentMailEvent(headers, `${payload} `, secret)).toBeNull();
    expect(verifyAgentMailEvent(headers, payload, undefined)).toBeNull();
  });
});
