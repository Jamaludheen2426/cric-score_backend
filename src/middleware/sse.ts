import { Response } from 'express';

type SseClient = {
  id: string;
  res: Response;
};

const clients: Map<string, SseClient[]> = new Map();

export function addSseClient(shareToken: string, id: string, res: Response) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const client: SseClient = { id, res };
  const existing = clients.get(shareToken) || [];
  clients.set(shareToken, [...existing, client]);

  // Send heartbeat every 30s
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 30000);

  res.on('close', () => {
    clearInterval(heartbeat);
    const remaining = (clients.get(shareToken) || []).filter(c => c.id !== id);
    if (remaining.length === 0) {
      clients.delete(shareToken);
    } else {
      clients.set(shareToken, remaining);
    }
  });
}

export function broadcastToMatch(shareToken: string, data: object) {
  const matchClients = clients.get(shareToken) || [];
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  matchClients.forEach(client => {
    try {
      client.res.write(payload);
    } catch (_) {
      // Client disconnected
    }
  });
}
