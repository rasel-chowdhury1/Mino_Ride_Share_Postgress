import { logger } from '../../utils/logger';

// How far in advance to notify drivers before the scheduled pickup time
const LEAD_TIME_MS = 15 * 60 * 1000; // 15 minutes

const scheduledJobs = new Map<string, NodeJS.Timeout>();

export const scheduleRideBroadcast = (
  rideId: string,
  scheduledAt: Date,
  broadcastFn: () => Promise<void>,
) => {
  cancelScheduledRideBroadcast(rideId);

  const broadcastAt = new Date(scheduledAt.getTime() - LEAD_TIME_MS);
  const delayMs = Math.max(0, broadcastAt.getTime() - Date.now());

  const timeout = setTimeout(async () => {
    scheduledJobs.delete(rideId);
    try {
      await broadcastFn();
    } catch (err) {
      logger.error(`ride.scheduler: broadcast for ride ${rideId} failed:`, err);
    }
  }, delayMs);

  scheduledJobs.set(rideId, timeout);

  logger.info(
    `ride.scheduler: ride ${rideId} queued — broadcast at ${broadcastAt.toISOString()} (${Math.round(delayMs / 1000)}s from now)`,
  );
};

export const cancelScheduledRideBroadcast = (rideId: string) => {
  const timeout = scheduledJobs.get(rideId);
  if (timeout) {
    clearTimeout(timeout);
    scheduledJobs.delete(rideId);
    logger.info(`ride.scheduler: cancelled broadcast for ride ${rideId}`);
  }
};
