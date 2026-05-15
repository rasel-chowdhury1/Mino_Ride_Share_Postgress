
// ─────────────────────────────────────────────────────────────────────────────
// notification.events.ts
// ─────────────────────────────────────────────────────────────────────────────

import { Socket } from 'socket.io';
import prisma from '../app/config/prisma';

export const connectedUsers = new Map<string, { socketID: string }>();

export function registerNotificationEvents(socket: Socket): void {
  const userId = socket.user?._id as string | undefined;
  if (!userId) return;

  connectedUsers.set(userId, { socketID: socket.id });

  prisma.notification.count({ where: { receiverId: userId, isRead: false } })
    .then((count) => {
      socket.emit('notification', {
        statusCode:  200,
        success:     true,
        unreadCount: count >= 0 ? count : 0,
        timestamp:   new Date(),
      });
    })
    .catch(() => {});

  socket.nsp.emit('onlineUser', Array.from(connectedUsers.keys()));

  socket.on('readNotification', () => {
    if (!socket.user?._id) return;

    prisma.notification
      .updateMany({ where: { receiverId: userId, isRead: false }, data: { isRead: true } })
      .catch((err) => console.error('Error updating notifications:', err));

    socket.emit('notification', {
      statusCode:  200,
      success:     true,
      unreadCount: 0,
      timestamp:   new Date(),
    });
  });

  socket.on('disconnect', () => {
    for (const [key, val] of connectedUsers.entries()) {
      if (val.socketID === socket.id) {
        connectedUsers.delete(key);
        break;
      }
    }
    socket.nsp.emit('onlineUser', Array.from(connectedUsers.keys()));
  });
}
