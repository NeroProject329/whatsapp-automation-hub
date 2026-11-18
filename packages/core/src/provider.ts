export type Receipt = "SENT" | "DELIVERED" | "READ";
export type InboundContent =
  "TEXT" | "IMAGE" | "VIDEO" | "AUDIO" | "DOCUMENT" | "STICKER";
export type ChannelUpdate =
  | {
      kind: "state";
      state: "CONNECTING" | "QR" | "READY" | "OFFLINE" | "EXPIRED" | "ERROR";
      code?: string;
      qr?: string;
      phone?: string;
    }
  | {
      kind: "inbound";
      id: string;
      address: string;
      phone: string | null;
      contentType?: InboundContent;
      text?: string;
      at: Date;
    }
  | { kind: "receipt"; id: string; receipt: Receipt; at: Date };
export interface SubmitText {
  phone: string | null;
  address?: string | null;
  text: string;
  id: string;
}
export interface MessagingProvider {
  attach(sink: (event: ChannelUpdate) => Promise<void>): Promise<void>;
  submit(input: SubmitText): Promise<{ id: string }>;
  close(revoke: boolean): Promise<void>;
}
export class FakeProvider implements MessagingProvider {
  private sink?: (event: ChannelUpdate) => Promise<void>;
  attach(sink: (event: ChannelUpdate) => Promise<void>) {
    this.sink = sink;
    return sink({ kind: "state", state: "READY" });
  }
  async submit(input: SubmitText) {
    if (!this.sink) throw new Error("NOT_READY");
    return { id: input.id };
  }
  async simulate(event: ChannelUpdate) {
    if (!this.sink) throw new Error("NOT_READY");
    await this.sink(event);
  }
  async close() {
    const sink = this.sink;
    this.sink = undefined;
    await sink?.({ kind: "state", state: "OFFLINE" });
  }
}
