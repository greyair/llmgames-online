import { wireValueSchema, type WireValue } from "@llmgames/game-catalog";

/** Local implementation of the socket operations used by rooms, including hibernation attachments. */
export class TestRoomSocket extends EventTarget implements WebSocket {
  readyState: number = WebSocket.OPEN;
  url: string | null = null;
  protocol: string | null = null;
  extensions: string | null = null;
  binaryType: "blob" | "arraybuffer" = "arraybuffer";
  readonly messages: Array<string | ArrayBuffer | ArrayBufferView> = [];
  private attachment: WireValue = null;

  accept(): void {
    this.readyState = WebSocket.OPEN;
  }

  send(message: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== WebSocket.OPEN) return;
    this.messages.push(message);
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
  }

  serializeAttachment<T>(attachment: T): void {
    this.attachment = wireValueSchema.parse(attachment);
  }

  deserializeAttachment(): WireValue {
    return structuredClone(this.attachment);
  }
}
