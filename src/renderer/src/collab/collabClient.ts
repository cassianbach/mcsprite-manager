import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import type { CollabHostInfo, Peer, CollabTextureSync } from '@shared/types';

const LOCAL_ORIGIN = 'local';

type StateListener = () => void;
type RemoteListener = () => void;
type SyncListener = () => void;

const PALETTE = ['#6cf0d6', '#ffd166', '#ef476f', '#06d6a0', '#118ab2', '#f78c6b', '#c792ea'];

function describeErr(e: unknown): string {
  if (!e) return 'unknown error';
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message);
  return String(e);
}

// A link received before an Editor (with a project) is mounted. Consumed on mount.
let pendingJoin: string | null = null;
export function setPendingJoin(link: string | null): void {
  pendingJoin = link;
  if (link) {
    // A link we're about to receive means we're joining a session as a guest.
    collab.isJoining = true;
  }
}
export function takePendingJoin(): string | null {
  const l = pendingJoin;
  pendingJoin = null;
  return l;
}

export class CollabClient {
  ydoc: Y.Doc | null = null;
  provider: WebsocketProvider | null = null;
  registry: Y.Map<CollabTextureSync> | null = null;
  status: 'offline' | 'connecting' | 'connected' = 'offline';
  isHost = false;
  isHosting = false;
  isJoining = false;
  hostInfo: CollabHostInfo | null = null;
  lastError: string | null = null;
  localName: string;
  localColor: string;

  private stateListeners = new Set<StateListener>();
  private remoteListeners = new Set<RemoteListener>();
  private awarenessListeners = new Set<() => void>();
  private syncListeners = new Set<SyncListener>();
  private applyingRemote = false;

  constructor() {
    this.localColor = PALETTE[Math.floor(Math.random() * PALETTE.length)];
    this.localName = 'User-' + Math.floor(Math.random() * 1000);
  }

  // ---- subscriptions ----
  onState(cb: StateListener): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }
  onRemote(cb: RemoteListener): () => void {
    this.remoteListeners.add(cb);
    return () => this.remoteListeners.delete(cb);
  }
  onAwareness(cb: () => void): () => void {
    this.awarenessListeners.add(cb);
    return () => this.awarenessListeners.delete(cb);
  }
  onSync(cb: SyncListener): () => void {
    this.syncListeners.add(cb);
    return () => this.syncListeners.delete(cb);
  }
  private emitState(): void {
    this.stateListeners.forEach((cb) => cb());
  }
  private emitRemote(): void {
    this.remoteListeners.forEach((cb) => cb());
  }

  isActive(): boolean {
    return this.status !== 'offline' && this.provider !== null;
  }

  isHostingSession(): boolean {
    return this.isHosting;
  }

  isJoiningSession(): boolean {
    return this.isJoining;
  }

  getPeers(): Peer[] {
    if (!this.provider) return [];
    const out: Peer[] = [];
    this.provider.awareness.getStates().forEach((state, clientId) => {
      if (clientId === this.provider!.awareness.clientID) return;
      const s = state as { name?: string; color?: string; cursor?: Peer['cursor'] };
      out.push({
        clientId,
        name: s.name ?? 'peer',
        color: s.color ?? '#888',
        cursor: s.cursor ?? null,
      });
    });
    return out;
  }

  // ---- lifecycle ----
  async startHost(projectId: string, relayUrl?: string): Promise<CollabHostInfo> {
    this.lastError = null;
    this.isHost = true;
    this.isHosting = true;
    this.isJoining = false;
    // A relay URL means the session lives on an external server (cross-network);
    // we don't spin up a local one. Otherwise we host the server on this machine
    // and the link carries our LAN address for same-network guests.
    this.hostInfo = await window.api.collab.start(projectId, relayUrl);
    if (relayUrl) {
      this.connect(relayUrl, projectId);
    } else {
      // The server runs in this machine's main process — connect over loopback,
      // which is far more reliable than looping back through the LAN IP.
      this.connect(`ws://127.0.0.1:${this.hostInfo.port}`, projectId);
    }
    return this.hostInfo;
  }

  joinLink(link: string): void {
    let host = '';
    let port = 0;
    let room = 'default';
    let relay: string | null = null;
    try {
      const u = new URL(link);
      relay = u.searchParams.get('relay');
      host = u.searchParams.get('host') || '';
      port = parseInt(u.searchParams.get('port') || '0', 10);
      room = u.searchParams.get('room') || 'default';
    } catch {
      // ignore parse errors
    }
    this.isHost = false;
    this.isHosting = false;
    this.isJoining = true;
    this.lastError = null;
    if (relay) {
      // External relay: connect straight to it, no loopback fallback needed.
      this.connect(relay, room);
      return;
    }
    if (!host || !port) return;
    const primary = `ws://${host}:${port}`;
    // Loopback fallback only makes sense when the host IS this machine
    // (e.g. two windows on the same PC). For a real cross-network peer the
    // LAN IP is correct, so we must NOT divert to 127.0.0.1 (it would never
    // reach the other machine). y-websocket auto-reconnects to `primary`.
    const isLocalhost = host === '127.0.0.1' || host === 'localhost';
    const fallback = isLocalhost ? `ws://127.0.0.1:${port}` : undefined;
    this.connect(primary, room, fallback);
  }

  private connect(url: string, room: string, fallbackUrl?: string): void {
    this.ydoc = new Y.Doc();
    this.registry = this.ydoc.getMap<CollabTextureSync>('registry');
    const onUpdate = (_e: unknown, txn: Y.Transaction) => {
      if (txn.origin === LOCAL_ORIGIN) return;
      this.observeRemote();
    };
    this.registry.observe(onUpdate);

    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;

    const makeProvider = (u: string): WebsocketProvider => {
      const p = new WebsocketProvider(u, room, this.ydoc!);
      p.on('status', (e: { status: string }) => {
        this.status = e.status === 'connected' ? 'connected' : 'connecting';
        if (e.status === 'connected') this.lastError = null;
        this.emitState();
        if (e.status === 'connected' && fallbackTimer) {
          clearTimeout(fallbackTimer);
          fallbackTimer = null;
        }
      });
      p.on('connection-error', (e: unknown) => {
        this.lastError = `Could not reach ${u} — ${describeErr(e)}`;
        this.emitState();
      });
      p.on('connection-close', (e: unknown) => {
        if (this.status !== 'connected') {
          this.lastError = `Disconnected from ${u} — ${describeErr(e)}`;
          this.emitState();
        }
      });
      p.on('sync', (isSynced: boolean) => {
        if (isSynced) this.syncListeners.forEach((cb) => cb());
      });
      p.awareness.setLocalState({
        name: this.localName,
        color: this.localColor,
        cursor: null,
      });
      p.awareness.on('change', () => {
        this.awarenessListeners.forEach((cb) => cb());
      });
      return p;
    };

    this.provider = makeProvider(url);
    this.emitState();

    if (fallbackUrl) {
      fallbackTimer = setTimeout(() => {
        if (this.provider && !this.provider.wsconnected) {
          this.provider.destroy();
          this.provider = makeProvider(fallbackUrl);
        }
        fallbackTimer = null;
      }, 2500);
    }
  }

  private observeRemote(): void {
    this.applyingRemote = true;
    this.emitRemote();
    // Release the guard on the next microtask so store subscribers that
    // read afterwards (and re-render) don't accidentally re-push.
    Promise.resolve().then(() => {
      this.applyingRemote = false;
    });
  }

  isApplyingRemote(): boolean {
    return this.applyingRemote;
  }

  getRegistry(): Record<string, CollabTextureSync> {
    if (!this.registry) return {};
    const out: Record<string, CollabTextureSync> = {};
    this.registry.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }

  // ---- push local changes ----
  pushEntry(entry: CollabTextureSync): void {
    if (!this.ydoc || !this.registry) return;
    this.ydoc.transact(() => {
      this.registry!.set(entry.id, entry);
    }, LOCAL_ORIGIN);
  }

  // Remove a texture from the shared project (e.g. when a collaborator deletes it).
  deleteEntry(id: string): void {
    if (!this.ydoc || !this.registry) return;
    this.ydoc.transact(() => {
      this.registry!.delete(id);
    }, LOCAL_ORIGIN);
  }

  setCursor(x: number, y: number, textureId: string): void {
    if (!this.provider) return;
    const current = (this.provider.awareness.getLocalState() as { cursor?: Peer['cursor'] }) || {};
    this.provider.awareness.setLocalState({
      ...current,
      cursor: { x, y, textureId },
    });
  }

  disconnect(): void {
    if (this.provider) {
      this.provider.awareness.setLocalState(null);
      this.provider.destroy();
      this.provider = null;
    }
    if (this.ydoc) {
      this.ydoc.destroy();
      this.ydoc = null;
    }
    if (this.isHost && this.hostInfo) {
      void window.api.collab.stop();
    }
    this.isHost = false;
    this.isHosting = false;
    this.isJoining = false;
    this.hostInfo = null;
    this.registry = null;
    this.status = 'offline';
    this.lastError = null;
    this.emitState();
  }
}

export const collab = new CollabClient();
