
import http from 'http';
import express from 'express';
import cors from 'cors';
import next from 'next';
import { Server, WebSocketTransport } from 'colyseus';
import { VoxelAcesRoom } from './rooms/VoxelAcesRoom';

const port = Number(process.env.PORT || 3000);
const dev = process.env.NODE_ENV !== 'production';
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

nextApp.prepare().then(() => {
  const app = express();

  app.use(cors());
  app.use(express.json());

  const server = http.createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({
      server,
    }),
  });

  // Register your room handlers
  gameServer.define('voxel_aces_room', VoxelAcesRoom);

  // Handle all other requests with Next.js
  app.all('*', (req, res) => {
    return handle(req, res);
  });

  server.listen(port, () => {
    console.log(`> Next.js server ready on http://localhost:${port}`);
    console.log(`> Colyseus server listening on ws://localhost:${port}`);
  });
});
