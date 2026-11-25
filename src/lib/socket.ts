import { io, type Socket } from 'socket.io-client';

let sharedSocket: Socket | null = null;

export function getSocket(): Socket {
  if (!sharedSocket) {
    sharedSocket = io({
      autoConnect: true,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 400,
      reconnectionDelayMax: 3000,
      transports: ['websocket', 'polling'],
      withCredentials: true,
    });
  }
  return sharedSocket;
}
