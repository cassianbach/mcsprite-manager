// Standalone Pixel Paint collaboration relay server.
// Runs the same y-websocket protocol the app's built-in server uses, so any
// Pixel Paint client can connect to it as a "relay" for cross-network sessions.
//
// Usage:
//   node relay-server.mjs                 # listens on 0.0.0.0:1234
//   PORT=9000 node relay-server.mjs       # custom port
//   HOST=127.0.0.1 node relay-server.mjs  # loopback only (local testing)
//
// Then use the printed URL (e.g. ws://YOUR_PUBLIC_IP:1234) as the relay address
// in Pixel Paint's "Start session" dialog.

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import os from 'node:os';

const PORT = parseInt(process.env.PORT || '1234', 10);
const HOST = process.env.HOST || '0.0.0.0';

const messageSync = 0;
const messageAwareness = 1;
const docs = new Map();

function toUint8Array(m) {
  if (Array.isArray(m)) {
    const total = m.reduce((n, part) => n + part.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const part of m) {
      out.set(new Uint8Array(part.buffer, part.byteOffset, part.byteLength), off);
      off += part.length;
    }
    return out;
  }
  if (m instanceof ArrayBuffer) return new Uint8Array(m);
  if (typeof m === 'string') return new TextEncoder().encode(m);
  return new Uint8Array(m.buffer, m.byteOffset, m.byteLength);
}

class WSSharedDoc extends Y.Doc {
  constructor(name) {
    super({ gc: true });
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);
    this.awareness.on('update', (changes, origin) => {
      const changedClients = changes.added.concat(changes.updated, changes.removed);
      if (origin != null) {
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
    });
    this.on('update', (update, _origin, doc) => {
      const wdoc = doc;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      syncProtocol.writeUpdate(encoder, update);
      const buff = encoding.toUint8Array(encoder);
      wdoc.conns.forEach((_c, conn) => send(wdoc, conn, buff));
    });
  }
}

function getYDoc(docName) {
  let doc = docs.get(docName);
  if (!doc) {
    doc = new WSSharedDoc(docName);
    docs.set(docName, doc);
  }
  return doc;
}

function send(doc, conn, m) {
  if (conn.readyState !== WebSocket.CONNECTING && conn.readyState !== WebSocket.OPEN) {
    closeConn(doc, conn);
    return;
  }
  try {
    conn.send(m, (err) => {
      if (err != null) closeConn(doc, conn);
    });
  } catch {
    closeConn(doc, conn);
  }
}

function closeConn(doc, conn) {
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

function messageListener(conn, doc, message) {
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
      awarenessProtocol.applyAwarenessUpdate(doc.awareness, decoding.readVarUint8Array(decoder), conn);
      break;
    default:
      break;
  }
}

function setupWSConnection(conn) {
  conn.binaryType = 'arraybuffer';
  const docName = (conn.url || '/').slice(1).split('?')[0] || 'default';
  const doc = getYDoc(docName);
  doc.conns.set(conn, new Set());

  conn.on('message', (message) => {
    try {
      messageListener(conn, doc, toUint8Array(message));
    } catch (e) {
      console.error('collab message error', e);
    }
  });
  conn.on('close', () => closeConn(doc, conn));

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

// Minimal HTTP server so the port responds to health checks / load balancers.
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Pixel Paint relay server is running.\n');
});

const wss = new WebSocketServer({ server });
wss.on('connection', setupWSConnection);

server.listen(PORT, HOST, () => {
  const lan = (() => {
    try {
      for (const name of Object.keys(os.networkInterfaces())) {
        for (const net of os.networkInterfaces()[name] ?? []) {
          if (net.family === 'IPv4' && !net.internal) return net.address;
        }
      }
    } catch {
      // ignore
    }
    return '127.0.0.1';
  })();
  console.log(`Pixel Paint relay listening on port ${PORT}`);
  console.log(`  Local:    ws://127.0.0.1:${PORT}`);
  console.log(`  Network: ws://${lan}:${PORT}`);
  console.log('Share the Network address (or your public IP/domain) as the relay URL in Pixel Paint.');
});
