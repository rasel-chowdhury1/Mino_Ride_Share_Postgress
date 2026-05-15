// ─────────────────────────────────────────────────────────────────────────────
// socketIo.ts — Public API for the socket layer (PostgreSQL / Prisma)
// ─────────────────────────────────────────────────────────────────────────────

import { NotificationType } from '@prisma/client';
import prisma from './app/config/prisma';
import { sendNotificationEmail } from './app/utils/emailNotification';
import { getIO, initSocketServer } from './socket/socket.server';
import { connectedUsers } from './socket/notification.events';

// ── Re-exports ─────────────────────────────────────────────────────────────
export { getIO as io };
export { initSocketServer as initSocketIO };
export { connectedUsers };

// ── Types ──────────────────────────────────────────────────────────────────

export interface NotificationPayload {
  userId: string;
  receiverId: string;
  message?: {
    fullName?: string;
    image?: string;
    text: string;
    photos?: string[];
  };
  type?: string;
}

// ── emitNotification ──────────────────────────────────────────────────────
// Saves notification to PostgreSQL and emits real-time socket event.

export const emitNotification = async ({
  userId,
  receiverId,
  message,
  type,
}: NotificationPayload): Promise<void> => {
  const io = getIO();
  const userSocket = connectedUsers.get(receiverId);

  const unreadCount = await prisma.notification.count({
    where: { receiverId, isRead: false },
  });

  if (message && userSocket) {
    io.to(userSocket.socketID).emit('notification', {
      message,
      statusCode: 200,
      success: true,
      unreadCount: unreadCount + 1,
      timestamp: new Date(),
    });
  }

  await prisma.notification.create({
    data: {
      userId,
      receiverId,
      fullName: message?.fullName ?? '',
      image:    message?.image    ?? '',
      text:     message?.text     ?? '',
      photos:   message?.photos   ?? [],
      type:     (type as NotificationType) ?? NotificationType.adminApprovalUpdate,
      isRead:   false,
    },
  });
};

// ── sentNotificationForRideRequest ────────────────────────────────────────

export const sentNotificationForRideRequest = async ({
  userId,
  receiverId,
  vehicleCategory,
}: {
  userId: string;
  receiverId: string;
  vehicleCategory?: string;
}): Promise<void> => {
  const [sender, receiver] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId },     select: { name: true, profileImage: true } }),
    prisma.user.findUnique({ where: { id: receiverId }, select: { name: true, email: true } }),
  ]);

  if (!sender || !receiver) return;

  const text = `${sender.name} has requested a ${vehicleCategory || 'ride'}.`;

  emitNotification({
    userId,
    receiverId,
    message: { fullName: sender.name ?? '', image: sender.profileImage, text, photos: [] },
    type: 'newRideRequest',
  }).catch((err) => console.error('Socket notification failed:', err));

  if (receiver.email) {
    sendNotificationEmail({ sentTo: receiver.email, subject: 'New Ride Request', userName: receiver.name || '', messageText: text })
      .catch((err) => console.error('Email notification failed:', err));
  }
};

// ── sentNotificationForRideCancelled ─────────────────────────────────────

export const sentNotificationForRideCancelled = async ({
  userId,
  receiverId,
  reason,
}: {
  userId: string;
  receiverId: string;
  reason?: string;
}): Promise<void> => {
  const [sender, receiver] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId },     select: { name: true, profileImage: true } }),
    prisma.user.findUnique({ where: { id: receiverId }, select: { name: true, email: true } }),
  ]);

  if (!sender || !receiver) return;

  const text = reason
    ? `${sender.name} has cancelled the ride. Reason: ${reason}`
    : `${sender.name} has cancelled the ride.`;

  emitNotification({
    userId,
    receiverId,
    message: { fullName: sender.name ?? '', image: sender.profileImage, text, photos: [] },
    type: 'tripCancelled',
  }).catch((err) => console.error('Socket notification failed:', err));

  if (receiver.email) {
    sendNotificationEmail({ sentTo: receiver.email, subject: 'Ride Cancelled', userName: receiver.name || '', messageText: text })
      .catch((err) => console.error('Email notification failed:', err));
  }
};

// ── sentNotificationForPaymentConfirmed ──────────────────────────────────

export const sentNotificationForPaymentConfirmed = async ({
  userId,
  receiverId,
  amount,
}: {
  userId: string;
  receiverId: string;
  amount?: number;
}): Promise<void> => {
  const [sender, receiver] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId },     select: { name: true, profileImage: true } }),
    prisma.user.findUnique({ where: { id: receiverId }, select: { name: true, email: true } }),
  ]);

  if (!sender || !receiver) return;

  const text = amount ? `Payment of ${amount} confirmed for your ride.` : `Your ride payment has been confirmed.`;

  emitNotification({
    userId,
    receiverId,
    message: { fullName: sender.name ?? '', image: sender.profileImage, text, photos: [] },
    type: 'paymentConfirmed',
  }).catch((err) => console.error('Socket notification failed:', err));

  if (receiver.email) {
    sendNotificationEmail({ sentTo: receiver.email, subject: 'Payment Confirmed', userName: receiver.name || '', messageText: text })
      .catch((err) => console.error('Email notification failed:', err));
  }
};

// ── sentNotificationForRideCompleted ─────────────────────────────────────

export const sentNotificationForRideCompleted = async ({
  userId,
  receiverId,
}: {
  userId: string;
  receiverId: string;
}): Promise<void> => {
  const [sender, receiver] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId },     select: { name: true, profileImage: true } }),
    prisma.user.findUnique({ where: { id: receiverId }, select: { name: true, email: true } }),
  ]);

  if (!sender || !receiver) return;

  const text = `Your ride with ${sender.name} has been completed. Thank you for riding!`;

  emitNotification({
    userId,
    receiverId,
    message: { fullName: sender.name ?? '', image: sender.profileImage, text, photos: [] },
    type: 'rideCompleted',
  }).catch((err) => console.error('Socket notification failed:', err));

  if (receiver.email) {
    sendNotificationEmail({ sentTo: receiver.email, subject: 'Ride Completed', userName: receiver.name || '', messageText: text })
      .catch((err) => console.error('Email notification failed:', err));
  }
};

// ── sentNotificationForDriverVerified ────────────────────────────────────

export const sentNotificationForDriverVerified = async ({
  userId,
  receiverId,
}: {
  userId: string;
  receiverId: string;
}): Promise<void> => {
  const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { name: true, email: true } });
  if (!receiver) return;

  const text = `Congratulations! Your driver account has been verified. You can now start accepting rides.`;

  emitNotification({
    userId,
    receiverId,
    message: { fullName: 'Admin', image: '', text, photos: [] },
    type: 'driverVerified',
  }).catch((err) => console.error('Socket notification failed:', err));

  if (receiver.email) {
    sendNotificationEmail({ sentTo: receiver.email, subject: 'Account Verified', userName: receiver.name || '', messageText: text })
      .catch((err) => console.error('Email notification failed:', err));
  }
};
