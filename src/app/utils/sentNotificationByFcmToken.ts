import admin from 'firebase-admin';
import { getMessaging, Message, MulticastMessage } from 'firebase-admin/messaging';

import prisma from '../config/prisma';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serviceAccount = require('../../../googleFirebaseAdmin.json') as object;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// ── Send FCM notification to a single user by their DB id ────────────────────

export const sendNotificationByFcmToken = async (
  receiverId: string,
  textMessage: string,
  titleName?: string,
): Promise<void> => {

  const user = await prisma.user.findUnique({
    where:  { id: receiverId },
    select: { fcmToken: true },
  });

  if (!user) {
    console.log(`User with id ${receiverId} not found`);
    return;
  }

  const { fcmToken } = user;
  if (!fcmToken?.trim()) {
    console.log(`No valid FCM token for user: ${receiverId}`);
    return;
  }

  const message: Message = {
    notification: { title: titleName || 'Mino Ride Share', body: textMessage },
    token: fcmToken,
  };


  getMessaging()
    .send(message)
    .then((r) => console.log('FCM sent:', r))
    .catch((e) => console.error('FCM error:', e));
};

// ── Send FCM notification to a list of driver profiles ───────────────────────

export const sendFcmToNearbyDrivers = async (
  driverProfileIds: string[],
  title: string,
  body: string,
): Promise<void> => {
  if (!driverProfileIds.length) return;

  try {
    const profiles = await prisma.driverProfile.findMany({
      where:  { id: { in: driverProfileIds } },
      select: { userId: true },
    });

    const userIds = profiles.map((p) => p.userId);
    if (!userIds.length) return;

    const users = await prisma.user.findMany({
      where:  { id: { in: userIds } },
      select: { fcmToken: true },
    });

    const tokens = users
      .map((u) => u.fcmToken)
      .filter((t): t is string => !!t?.trim());

    if (!tokens.length) return;

    const multicast: MulticastMessage = {
      notification: { title, body },
      tokens,
    };

    const result = await getMessaging().sendEachForMulticast(multicast);
    console.log(`sendFcmToNearbyDrivers: ${result.successCount}/${tokens.length} sent`);
  } catch (err) {
    console.error('sendFcmToNearbyDrivers error:', err);
  }
};

// ── Send a reminder notification to a single user ────────────────────────────

export const sendReminderNotification = async (
  receiverId: string,
  title: string,
  textMessage: string,
): Promise<void> => {
  const user = await prisma.user.findUnique({
    where:  { id: receiverId },
    select: { fcmToken: true },
  });

  if (!user) {
    console.log(`User with id ${receiverId} not found`);
    return;
  }

  const { fcmToken } = user;
  if (!fcmToken?.trim()) {
    console.log(`No valid FCM token for user: ${receiverId}`);
    return;
  }

  const message: Message = {
    notification: { title, body: textMessage },
    token: fcmToken,
  };

  getMessaging()
    .send(message)
    .then((r) => console.log('Reminder FCM sent:', r))
    .catch((e) => console.error('Reminder FCM error:', e));
};
