import makeWASocket, {
  BufferJSON,
  DisconnectReason,
  initAuthCreds,
  jidDecode,
  isLidUser,
  isPnUser,
  jidNormalizedUser,
  normalizeMessageContent,
  proto,
} from "baileys";
import type {
  AuthenticationState,
  SignalDataSet,
  SignalDataTypeMap,
  WAMessageKey,
  WASocket,
  WAMessageContent,
} from "baileys";
import pino from "pino";
import { decrypt, encrypt, phone, transact, log } from "@hub/core";
import type {
  PrismaClient,
  ChannelUpdate,
  MessagingProvider,
  SubmitText,
  Receipt,
  InboundContent,
} from "@hub/core";

export function classifyInbound(
  message: WAMessageContent,
): { contentType: InboundContent; text?: string } | undefined {
  const content = normalizeMessageContent(message);
  if (!content) return;
  const text = content.conversation ?? content.extendedTextMessage?.text;
  if (text) return { contentType: "TEXT", text };
  if (content.imageMessage)
    return {
      contentType: "IMAGE",
      text: content.imageMessage.caption ?? undefined,
    };
  if (content.videoMessage)
    return {
      contentType: "VIDEO",
      text: content.videoMessage.caption ?? undefined,
    };
  if (content.audioMessage) return { contentType: "AUDIO" };
  if (content.documentMessage)
    return {
      contentType: "DOCUMENT",
      text: content.documentMessage.caption ?? undefined,
    };
  if (content.stickerMessage) return { contentType: "STICKER" };
}

export class BaileysProvider implements MessagingProvider {
  private socket?: WASocket;
  private stream: Promise<void> = Promise.resolve();
  private dead = false;
  private sink?: (event: ChannelUpdate) => Promise<void>;
  constructor(
    private db: PrismaClient,
    private encryptionKey: string,
    private id: string,
    private generation: number,
  ) {}
  private aad(category: string, key: string) {
    return JSON.stringify([this.id, category, key]);
  }
  private decode(category: string, key: string, value: string) {
    return JSON.parse(
      decrypt(this.encryptionKey, value, this.aad(category, key)),
      BufferJSON.reviver,
    );
  }
  private encode(category: string, key: string, data: unknown) {
    return encrypt(
      this.encryptionKey,
      JSON.stringify(data, BufferJSON.replacer),
      this.aad(category, key),
    );
  }
  private save(data: SignalDataSet, credentials?: string) {
    return transact(this.db, async (tx) => {
      const row = await tx.connection.findFirst({
        where: { id: this.id, generation: this.generation, desired: "ON" },
        select: { id: true },
      });
      if (!row) return;
      const write = async (
        category: string,
        key: string,
        value: string | null,
      ) => {
        const pk = { connectionId: this.id, category, key };
        if (value === null) await tx.authEntry.deleteMany({ where: pk });
        else
          await tx.authEntry.upsert({
            where: { connectionId_category_key: pk },
            create: { ...pk, value },
            update: { value },
          });
      };
      if (credentials) await write("creds", "current", credentials);
      for (const [category, entries] of Object.entries(data)) {
        for (const [key, value] of Object.entries(entries ?? {}))
          await write(
            category,
            key,
            value === null || value === undefined
              ? null
              : this.encode(category, key, value),
          );
      }
    });
  }
  private enqueue(fn: () => Promise<void>) {
    this.stream = this.stream
      .then(async () => {
        if (this.dead) return;
        await fn();
      })
      .catch(() => {
        log("provider_event_store_failed");
        // A failed key/event commit must not leave a socket sending against stale state.
        process.exit(2);
      });
  }
  private pn(jid: string | undefined | null) {
    if (!jid || !isPnUser(jid)) return null;
    return phone("+" + (jidDecode(jid)?.user ?? ""));
  }
  private async inbound(key: WAMessageKey) {
    const address = key.remoteJid;
    if (
      !address ||
      key.fromMe !== false ||
      (!isPnUser(address) && !isLidUser(address))
    )
      return;
    const alternate = key.remoteJidAlt;
    let number = this.pn(address) ?? this.pn(alternate);
    if (!number && isLidUser(address)) {
      number = this.pn(
        await this.socket?.signalRepository.lidMapping.getPNForLID(address),
      );
    }
    return { address: jidNormalizedUser(address), phone: number };
  }
  async attach(sink: (event: ChannelUpdate) => Promise<void>) {
    this.sink = sink;
    const cached = await this.db.authEntry.findUnique({
      where: {
        connectionId_category_key: {
          connectionId: this.id,
          category: "creds",
          key: "current",
        },
      },
    });
    const auth: AuthenticationState = {
      creds: cached
        ? this.decode("creds", "current", cached.value)
        : initAuthCreds(),
      keys: {
        get: async <T extends keyof SignalDataTypeMap>(
          type: T,
          ids: string[],
        ) => {
          const rows = await this.db.authEntry.findMany({
            where: { connectionId: this.id, category: type, key: { in: ids } },
          });
          const result: Record<string, SignalDataTypeMap[T]> = {};
          for (const r of rows) {
            const value = this.decode(type, r.key, r.value);
            result[r.key] =
              type === "app-state-sync-key"
                ? (proto.Message.AppStateSyncKeyData.fromObject(
                    value,
                  ) as unknown as SignalDataTypeMap[T])
                : value;
          }
          return result;
        },
        set: (data) => this.save(data),
      },
    };
    await sink({ kind: "state", state: "CONNECTING" });
    const sock = makeWASocket({
      auth,
      logger: pino({ level: "silent" }),
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      emitOwnEvents: false,
      defaultQueryTimeoutMs: 15000,
      connectTimeoutMs: 20000,
      getMessage: async () => undefined,
    });
    this.socket = sock;
    sock.ev.on("creds.update", () => {
      const snapshot = this.encode("creds", "current", auth.creds);
      this.enqueue(() => this.save({}, snapshot));
    });
    sock.ev.on("connection.update", (event) =>
      this.enqueue(async () => {
        if (event.connection === "close") {
          const err = event.lastDisconnect?.error as
            { output?: { statusCode?: number } } | undefined;
          const code = err?.output?.statusCode;
          if (
            code === DisconnectReason.loggedOut ||
            code === DisconnectReason.badSession ||
            code === DisconnectReason.multideviceMismatch
          ) {
            await sink({
              kind: "state",
              state: "EXPIRED",
              code: "PROVIDER_AUTH_EXPIRED",
            });
          } else if (
            code === DisconnectReason.connectionReplaced ||
            code === DisconnectReason.forbidden
          ) {
            await sink({
              kind: "state",
              state: "ERROR",
              code: "PROVIDER_CONNECTION_REFUSED",
            });
          } else {
            await sink({
              kind: "state",
              state:
                code === DisconnectReason.restartRequired
                  ? "CONNECTING"
                  : "OFFLINE",
              code:
                code === DisconnectReason.restartRequired
                  ? "PROVIDER_RESTART_REQUIRED"
                  : "PROVIDER_DISCONNECTED",
            });
          }
          return;
        }
        if (event.qr) await sink({ kind: "state", state: "QR", qr: event.qr });
        if (event.connection === "open") {
          let number = this.pn(sock.user?.id);
          if (!number && sock.user?.id && isLidUser(sock.user.id))
            number = this.pn(
              await sock.signalRepository.lidMapping.getPNForLID(sock.user.id),
            );
          await sink(
            number
              ? { kind: "state", state: "READY", phone: number }
              : {
                  kind: "state",
                  state: "ERROR",
                  code: "ACCOUNT_IDENTITY_UNRESOLVED",
                },
          );
        }
      }),
    );
    sock.ev.on("messages.upsert", (data) => {
      if (data.type !== "notify" || data.requestId) return;
      this.enqueue(async () => {
        for (const m of data.messages) {
          if (!m.key.id || !m.message) continue;
          const from = await this.inbound(m.key);
          if (!from) continue;
          const content = classifyInbound(m.message);
          if (!content) continue;
          const at = new Date(Number(m.messageTimestamp) * 1000);
          if (!Number.isFinite(+at)) continue;
          await sink({
            kind: "inbound",
            id: m.key.id,
            ...from,
            contentType: content.contentType,
            text: content.text?.slice(0, 4096),
            at,
          });
        }
      });
    });
    sock.ev.on("messages.update", (updates) =>
      this.enqueue(async () => {
        for (const { key, update } of updates) {
          if (
            !key.fromMe ||
            !key.id ||
            !key.remoteJid ||
            (!isPnUser(key.remoteJid) && !isLidUser(key.remoteJid))
          )
            continue;
          const s = proto.WebMessageInfo.Status;
          const receipt: Receipt | undefined =
            update.status === s.SERVER_ACK
              ? "SENT"
              : update.status === s.DELIVERY_ACK
                ? "DELIVERED"
                : update.status === s.READ
                  ? "READ"
                  : undefined;
          if (receipt)
            await sink({
              kind: "receipt",
              id: key.id,
              receipt,
              at: new Date(),
            });
        }
      }),
    );
  }
  async submit(input: SubmitText) {
    if (!this.socket || this.dead) throw new Error("NOT_READY");
    const jid = input.address ?? input.phone?.slice(1) + "@s.whatsapp.net";
    if (!jid || (!isPnUser(jid) && !isLidUser(jid)))
      throw new Error("RECIPIENT_INVALID");
    const message = await this.socket.sendMessage(
      jid,
      { text: input.text },
      { messageId: input.id },
    );
    if (!message?.key.id) throw new Error("PROVIDER_RESPONSE_MISSING");
    return { id: message.key.id };
  }
  async close(revoke: boolean) {
    this.dead = true;
    const sock = this.socket;
    this.socket = undefined;
    if (sock) {
      try {
        if (revoke) await sock.logout();
      } finally {
        sock.end(undefined);
      }
    }
    await this.stream;
    this.sink = undefined;
  }
}
