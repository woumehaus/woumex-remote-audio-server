# WoumeX Remote Audio — Signaling Server

Servidor de sinalização WebRTC para sessões de áudio remoto autorizadas.

- Health check: `/health`
- WebSocket: `/ws`
- Start: `npm start`
- Node.js: 20+

O áudio WebRTC não é retransmitido por este servidor; ele coordena a conexão entre os aparelhos.
