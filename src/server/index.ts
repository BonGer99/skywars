
import http from 'http';
import express from 'express';
import cors from 'cors';
import next from 'next';
import { Server } from 'colyseus';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { VoxelAcesRoom } from './rooms/VoxelAcesRoom';
import { parse } from 'url';

const getPort = () => {
  const portArgIndex = process.argv.indexOf('--port');
  if (portArgIndex !== -1 && process.argv[portArgIndex + 1]) {
    return Number(process.argv[portArgIndex + 1]);
  }
  return Number(process.env.PORT || 3000);
};

const port = getPort();
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
      server
    }),
  });

  gameServer.define('voxel_aces_room', VoxelAcesRoom);

  app.all('*', (req, res) => {
    const parsedUrl = parse(req.url!, true);
    return handle(req, res, parsedUrl);
  });
  
  server.listen(port, () => {
    console.log(`> Next.js server ready on http://localhost:${port}`);
    console.log(`> Colyseus server listening on ws://localhost:${port}`);
  });
});
