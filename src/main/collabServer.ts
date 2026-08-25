import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import * as os from 'node:os';

const messageSync = 0;
const messageAwareness = 1;

const docs = new Map<string, WSSharedDoc>();

type RawMessage = ArrayBuffer | Buffer | string;

function toUint8Array(m: RawMessage | RawMessage[]): Uint8Array {
  if (Array.isArray(m)) {
    // Concatenate Buffer[] (rare for ws).
    const total = m.reduce((n, part) => n + (part as Buffer).length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const part of m) {
      const b = part as Buffer;
      out.set(new Uint8Array(b.buffer, b.byteOffset, b.byteLength), off);
      off += b.byteLength;
    }
    return out;
  }
  if (m instanceof ArrayBuffer) return new Uint8Array(m);
  if (typeof m === 'string') return new TextEncoder().encode(m);
  return new Uint8Array(m.buffer, m.byteOffset, m.byteLength);
}

class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Map<WebSocket, Set<number>>;
  awareness: awarenessProtocol.Awareness;

  constructor(name: string) {
    super({ gc: true });
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    this.awareness.on(
      'update',
      (
        changes: { added: number[]; updated: number[]; removed: number[] },
        origin: WebSocket | null,
      ) => {
        const changedClients = changes.added.concat(changes.updated, changes.removed);
        if (origin !== null && origin !== undefined) {
          const controlled = this.conns.get(origin);
          if (controlled !== undefined) {
            changes.added.forEach((id) => controlled.add(id));
            changes.removed.forEach((id) => controlled.delete(id));
          }
        }
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageAwareness);
        encoding.writeVarUint8Array(
          encoder,
          awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
        );
        const buff = encoding.toUint8Array(encoder);
        this.conns.forEach((_c, conn) => send(this, conn, buff));
      },
    );

    this.on('update', (update: Uint8Array, _origin: unknown, doc: Y.Doc) => {
      const wdoc = doc as WSSharedDoc;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const buff = encoding.toUint8Array(encoder);
      wdoc.conns.forEach((_c, conn) => send(wdoc, conn, buff));
    });
  }
}

function getYDoc(docName: string): WSSharedDoc {
  let doc = docs.get(docName);
  if (!doc) {
    doc = new WSSharedDoc(docName);
    docs.set(docName, doc);
  }
  return doc;
}

function send(doc: WSSharedDoc, conn: WebSocket, m: Uint8Array): void {
  if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(m, (err?: Error) => {
      if (err != null) closeConn(doc, conn);
    });
  } catch {
    closeConn(doc, conn);
  }
}

function closeConn(doc: WSSharedDoc, conn: WebSocket): void {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn);
    if (controlledIds) {
      awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    }
    doc.conns.delete(conn);
    if (doc.conns.size === 0) {
      doc.destroy();
      docs.delete(doc.name);
    }
  }
  try {
    conn.close();
  } catch {
    // ignore
  }
}

function messageListener(conn: WebSocket, doc: WSSharedDoc, message: Uint8Array): void {
  const encoder = encoding.createEncoder();
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);
  switch (messageType) {
    case messageSync:
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
      if (encoding.length(encoder) > 1) send(doc, conn, encoding.toUint8Array(encoder));
      break;
    case messageAwareness:
      awarenessProtocol.applyAwarenessUpdate(
        doc.awareness,
        decoding.readVarUint8Array(decoder),
        conn,
      );
      break;
    default:
      break;
  }
}

function setupWSConnection(conn: WebSocket, req: IncomingMessage): void {
  conn.binaryType = 'arraybuffer';
  const docName = (req.url || '/').slice(1).split('?')[0] || 'default';
  const doc = getYDoc(docName);
  doc.conns.set(conn, new Set());

  conn.on('message', (message: RawMessage | RawMessage[]) => {
    try {
      messageListener(conn, doc, toUint8Array(message));
    } catch (e) {
      console.error('collab message error', e);
    }
  });
  conn.on('close', () => closeConn(doc, conn));

  // Sync step 1
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeSyncStep1(encoder, doc);
  send(doc, conn, encoding.toUint8Array(encoder));

  const states = doc.awareness.getStates();
  if (states.size > 0) {
    const aEncoder = encoding.createEncoder();
    encoding.writeVarUint(aEncoder, messageAwareness);
    encoding.writeVarUint8Array(
      aEncoder,
      awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(states.keys())),
    );
    send(doc, conn, encoding.toUint8Array(aEncoder));
  }
}

let activeServer: WebSocketServer | null = null;

export async function startCollabServer(): Promise<{ port: number; stop: () => void }> {
  if (activeServer) {
    const port = (activeServer.address() as { port: number }).port;
    return { port, stop: () => stopCollabServer() };
  }
  const wss = new WebSocketServer({ port: 0 });
  wss.on('connection', setupWSConnection);
  await new Promise<void>((resolve, reject) => {
    wss.once('listening', () => resolve());
    wss.once('error', (e) => reject(e));
  });
  activeServer = wss;
  const address = wss.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { port, stop: () => stopCollabServer() };
}

export function stopCollabServer(): void {
  if (activeServer) {
    activeServer.close();
    activeServer = null;
  }
  docs.clear();
}

/** Best-effort LAN IPv4 address for building a shareable host URL. */
export function getLanAddress(): string {
  try {
    const nets = os.networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] ?? []) {
        if (net.family === 'IPv4' && !net.internal) return net.address;
      }
    }
  } catch {
    // ignore
  }
  return '127.0.0.1';
}
