const http = require('http');
const crypto = require('crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { URL } = require('url');

const port = Number(process.env.PORT || 8080);
const rooms = new Map();

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, service: 'WoumeX Signaling', rooms: rooms.size }));
  }
  res.writeHead(404);
  res.end('not found');
});

const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 256 * 1024 });

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeSend(ws, payload) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(payload);
}

function iceConfig() {
  const servers = [
    { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }
  ];
  const url = process.env.TURN_URL;
  const username = process.env.TURN_USERNAME;
  const credential = process.env.TURN_PASSWORD;
  if (url && username && credential) {
    servers.push({ urls: [url], username, credential });
  }
  return JSON.stringify({ type: 'ice-config', servers });
}

function getRoom(code, token) {
  const tokenHash = hash(token);
  const existing = rooms.get(code);
  if (existing) return existing.tokenHash === tokenHash ? existing : null;
  const room = { tokenHash, sender: null, listener: null };
  rooms.set(code, room);
  return room;
}

function removeIfEmpty(code, room) {
  if (!room.sender && !room.listener) rooms.delete(code);
}

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const roomCode = (url.searchParams.get('room') || '').trim().toUpperCase();
  const role = url.searchParams.get('role');
  const token = (url.searchParams.get('token') || '').trim().toUpperCase();

  if (!roomCode || token.length < 8 || !['sender', 'listener'].includes(role)) {
    return ws.close(1008, 'invalid connection');
  }

  const room = getRoom(roomCode, token);
  if (!room) return ws.close(1008, 'invalid code');

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  safeSend(ws, iceConfig());

  if (role === 'sender') {
    if (room.sender && room.sender !== ws) room.sender.close(1000, 'replaced');
    room.sender = ws;
    safeSend(room.listener, JSON.stringify({ type: 'sender-ready' }));
  } else {
    if (room.listener && room.listener !== ws) room.listener.close(1000, 'replaced');
    room.listener = ws;
    safeSend(room.sender, JSON.stringify({ type: 'listener-ready' }));
  }

  ws.on('message', (data, isBinary) => {
    if (isBinary || data.length > 256 * 1024) return;
    const text = data.toString();
    if (role === 'sender') safeSend(room.listener, text);
    else safeSend(room.sender, text);
  });

  ws.on('close', () => {
    if (role === 'sender' && room.sender === ws) {
      room.sender = null;
      safeSend(room.listener, JSON.stringify({ type: 'peer-left' }));
    }
    if (role === 'listener' && room.listener === ws) {
      room.listener = null;
      safeSend(room.sender, JSON.stringify({ type: 'peer-left' }));
    }
    removeIfEmpty(roomCode, room);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

wss.on('close', () => clearInterval(heartbeat));
server.listen(port, '0.0.0.0', () => console.log(`WoumeX signaling online on port ${port}`));
