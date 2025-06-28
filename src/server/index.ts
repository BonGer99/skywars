
import http from 'http';
import express from 'express';
import cors from 'cors';
import next from 'next';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { VoxelAcesRoom } from './rooms/VoxelAcesRoom';
import { parse } from 'url';

const portIndex = process.argv.indexOf('--port');
const port = portIndex > -1 ? parseInt(process.argv[portIndex + 1], 10) : Number(process.env.PORT || 3000);

const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const server = http.createServer(app);
  
  // Use `noServer: true` to prevent Colyseus from hijacking the 'upgrade' event
  const gameServer = new Server({
    transport: new WebSocketTransport({
      noServer: true
    }),
  });

  // Register your room handlers
  gameServer.define('voxel_aces_room', VoxelAcesRoom);

  // Handle all regular HTTP requests with Next.js
  app.all('*', (req, res) => {
    return handle(req, res);
  });
  
  // Manually handle WebSocket upgrades
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url!, true);

    // Delegate to Colyseus only for the '/colyseus' path
    if (pathname === '/colyseus') {
      gameServer.transport.handleUpgrade(request, socket, head, (client) => {
        gameServer.onConnection(client, request);
      });
    } else {
      // Let Next.js's internal WebSocket server handle its own connections.
      // By not destroying the socket here, we allow other listeners to process it.
    }
  });


  server.listen(port, () => {
    console.log(`> Next.js server ready on http://localhost:${port}`);
    console.log(`> Colyseus server listening on ws://localhost:${port}/colyseus`);
  });
});
