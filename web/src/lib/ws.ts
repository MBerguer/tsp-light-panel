import type { ClientMessage } from "@/types/ClientMessage";
import type { ClientRole } from "@/types/ClientRole";
import type { ServerMessage } from "@/types/ServerMessage";

type Listener = (msg: ServerMessage) => void;
type StatusListener = (status: ConnectionStatus) => void;

export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "open"
  | "closed"
  | "error";

/**
 * Resilient WebSocket client with exponential backoff reconnect.
 *
 * Wire protocol matches `tsp_core::wire`:
 *
 * * sends `ClientMessage::Hello { role }` immediately after open;
 * * dispatches every incoming `ServerMessage` to the registered listener;
 * * exposes a thin `send` for `SubmitCommand` / `Subscribe` / `Ping`.
 */
export class WsClient {
  private url: string;
  private role: ClientRole;
  private socket: WebSocket | null = null;
  private status: ConnectionStatus = "idle";
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private retries = 0;
  private nextNonce = 1;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private explicitClose = false;

  constructor(url: string, role: ClientRole) {
    this.url = url;
    this.role = role;
  }

  setRole(role: ClientRole): void {
    this.role = role;
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.sendHello();
    }
  }

  onMessage(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  onStatus(fn: StatusListener): () => void {
    this.statusListeners.add(fn);
    fn(this.status);
    return () => this.statusListeners.delete(fn);
  }

  connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }
    this.explicitClose = false;
    this.setStatus("connecting");
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.retries = 0;
      this.setStatus("open");
      this.sendHello();
      this.startHeartbeat();
    });

    socket.addEventListener("message", (event) => {
      let parsed: ServerMessage | null = null;
      try {
        parsed = JSON.parse(event.data) as ServerMessage;
      } catch (err) {
        console.warn("malformed WS frame", err);
        return;
      }
      this.listeners.forEach((l) => l(parsed!));
    });

    socket.addEventListener("close", () => {
      this.stopHeartbeat();
      this.setStatus("closed");
      if (!this.explicitClose) this.scheduleReconnect();
    });

    socket.addEventListener("error", (e) => {
      console.warn("WS error", e);
      this.setStatus("error");
    });
  }

  send(msg: ClientMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(msg));
  }

  ping(): number {
    const nonce = this.nextNonce++;
    this.send({ type: "ping", nonce } as ClientMessage);
    return nonce;
  }

  close(): void {
    this.explicitClose = true;
    this.stopHeartbeat();
    this.socket?.close();
  }

  private sendHello(): void {
    this.send({
      type: "hello",
      role: this.role,
      client_version: "0.1.0",
    } as ClientMessage);
  }

  private setStatus(s: ConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    this.statusListeners.forEach((l) => l(s));
  }

  private scheduleReconnect(): void {
    this.retries = Math.min(this.retries + 1, 7);
    const delay = Math.min(15000, 500 * 2 ** (this.retries - 1));
    setTimeout(() => this.connect(), delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeat = setInterval(() => this.ping(), 10_000);
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }
}

export function buildDefaultUrl(): string {
  if (typeof window === "undefined") return "ws://127.0.0.1:7878/ws";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}
