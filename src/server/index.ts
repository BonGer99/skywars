import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server } from 'colyseus';
import { VoxelAcesRoom } from './rooms/VoxelAcesRoom';

const port = Number(process.env.PORT || 2567);
const app = express();

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const gameServer = new Server({
  server,
});

// Register your room handlers
gameServer.define('voxel_aces_room', VoxelAcesRoom);

gameServer.listen(port);
console.log(`Colyseus server listening on port: ${port}`);
