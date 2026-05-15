
import { NotificationType } from '@prisma/client';
import AppError from '../../error/AppError';
import httpStatus from 'http-status';
import prisma from '../../config/prisma';

interface ICreateNotificationProps {
  userId:     string;
  receiverId: string;
  message: {
    fullName?: string;
    image?:    string;
    text:      string;
    photos?:   string[];
  };
  type: NotificationType;
}

const createNotification = async ({ userId, receiverId, message, type }: ICreateNotificationProps) => {
  return prisma.notification.create({
    data: {
      userId,
      receiverId,
      fullName: message.fullName ?? '',
      image:    message.image    ?? '',
      text:     message.text,
      photos:   message.photos   ?? [],
      type,
    },
  });
};

const getAllNotifications = async (query: Record<string, unknown>) => {
  const receiverId = query.receiverId as string | undefined;

  return prisma.notification.findMany({
    where:   receiverId ? { receiverId } : {},
    orderBy: { createdAt: 'desc' },
    include: {
      sender:   { select: { name: true, profileImage: true } },
      receiver: { select: { name: true, profileImage: true } },
    },
  });
};

const getMyNotifications = async (receiverId: string) => {
  return prisma.notification.findMany({
    where:   { receiverId },
    orderBy: { createdAt: 'desc' },
    include: {
      sender:   { select: { name: true, profileImage: true } },
      receiver: { select: { name: true, profileImage: true } },
    },
  });
};

const markAsRead = async (id: string) => {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) throw new AppError(httpStatus.NOT_FOUND, 'Notification not found');

  return prisma.notification.update({ where: { id }, data: { isRead: true } });
};

const markAllAsRead = async (receiverId: string) => {
  await prisma.notification.updateMany({ where: { receiverId, isRead: false }, data: { isRead: true } });
  return { message: 'All notifications marked as read' };
};

const deleteNotification = async (id: string) => {
  const notification = await prisma.notification.findUnique({ where: { id } });
  if (!notification) throw new AppError(httpStatus.NOT_FOUND, 'Notification not found');

  await prisma.notification.delete({ where: { id } });
  return { message: 'Notification deleted successfully' };
};

export const notificationService = {
  createNotification,
  getAllNotifications,
  getMyNotifications,
  markAsRead,
  markAllAsRead,
  deleteNotification,
};
