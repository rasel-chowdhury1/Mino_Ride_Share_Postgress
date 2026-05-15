import { NotificationType } from '@prisma/client';
import prisma from '../../config/prisma';

type TNotificationInput = {
  senderId?:    string;
  receiverId:   string;
  text:         string;
  senderName?:  string;
  senderImage?: string;
  type:         NotificationType;
};

/** Resolves a valid userId for the sender.
 *  If senderId is provided and exists in users, use it.
 *  Otherwise fall back to receiverId (system/self notification). */
async function resolveSenderId(senderId: string | undefined, receiverId: string): Promise<string> {
  if (senderId && senderId !== receiverId) {
    const exists = await prisma.user.findUnique({ where: { id: senderId }, select: { id: true } });
    if (exists) return senderId;
  }
  return receiverId;
}

/**
 * Save a single in-app notification to the DB.
 * Fire-and-forget safe — never throws.
 */
export const saveNotification = async (input: TNotificationInput): Promise<void> => {
  try {
    const userId = await resolveSenderId(input.senderId, input.receiverId);

    await prisma.notification.create({
      data: {
        userId,
        receiverId:  input.receiverId,
        fullName:    input.senderName  ?? '',
        image:       input.senderImage ?? '',
        text:        input.text,
        type:        input.type,
      },
    });
  } catch (err) {
    console.error('saveNotification error:', err);
  }
};

/**
 * Save in-app notifications to nearby drivers given their driverProfileIds.
 * Resolves driverProfileId → userId internally.
 * Fire-and-forget safe — never throws.
 */
export const saveNotificationToDriversByProfileId = async (
  driverProfileIds: string[],
  input: Omit<TNotificationInput, 'receiverId'>,
): Promise<void> => {
  if (!driverProfileIds.length) return;
  try {
    const profiles = await prisma.driverProfile.findMany({
      where:  { id: { in: driverProfileIds } },
      select: { userId: true },
    });

    const userIds = profiles.map((p) => p.userId);
    await saveNotificationToMany(userIds, input);
  } catch (err) {
    console.error('saveNotificationToDriversByProfileId error:', err);
  }
};

/**
 * Save in-app notifications to multiple receivers.
 * Fire-and-forget safe — never throws.
 */
export const saveNotificationToMany = async (
  receiverIds: string[],
  input: Omit<TNotificationInput, 'receiverId'>,
): Promise<void> => {
  if (!receiverIds.length) return;
  try {
    // Validate senderId once for the whole batch
    const firstReceiverId = receiverIds[0];
    const userId = await resolveSenderId(input.senderId, firstReceiverId);

    await prisma.notification.createMany({
      data: receiverIds.map((receiverId) => ({
        userId,
        receiverId,
        fullName:    input.senderName  ?? '',
        image:       input.senderImage ?? '',
        text:        input.text,
        type:        input.type,
      })),
      skipDuplicates: true,
    });
  } catch (err) {
    console.error('saveNotificationToMany error:', err);
  }
};
