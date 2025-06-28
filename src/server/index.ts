
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
  
  // Attach Colyseus to the existing HTTP server
  const gameServer = new Server({
    transport: new WebSocketTransport({
      server // Attach to the main http server
    }),
  });

  // Register your room handlers
  gameServer.define('voxel_aces_room', VoxelAcesRoom);

  // Handle all regular HTTP requests with Next.js
  app.all('*', (req, res) => {
    // Be sure to pass `true` as the second argument to `url.parse`.
    // This tells it to parse the query portion of the URL.
    const parsedUrl = parse(req.url!, true);
    return handle(req, res, parsedUrl);
  });
  
  server.listen(port, () => {
    console.log(`> Next.js server ready on http://localhost:${port}`);
    console.log(`> Colyseus server listening on ws://localhost:${port}`);
  });
});
