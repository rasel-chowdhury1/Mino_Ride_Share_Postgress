
import dns from 'dns';
dns.setServers(['8.8.8.8', '8.8.4.4']);

import { createServer, Server } from 'http';
import app from './app';
import colors from 'colors';
import config from './app/config';
import prisma from './app/config/prisma';
import createDefaultAdmin from './app/DB/createDefaultAdmin';
import { initSocketServer } from './socket/socket.server';
import { isManagerReady, broadcastToNearbyDrivers } from './socket/socket.manager';
import { logger } from './app/utils/logger';
import { SocketEvents } from './socket/socket.types';
import { RideStatus } from '@prisma/client';
import cron from 'node-cron';

let server: Server;
let socketHttpServer: Server;

async function main() {
  try {
    createDefaultAdmin();

    server = createServer(app);
    socketHttpServer = createServer();

    server.listen(Number(config.port), () => {
      console.log(
        colors.green(
          `---> ${config.project_name} server listening on http://${config.ip}:${config.port}`,
        ).bold,
      );

      initSocketServer(socketHttpServer).catch((err) =>
        logger.error('Socket.IO init error:', err),
      );

      cron.schedule('* * * * *', async () => {
        try {
          const now        = new Date();
          const notifyTime = new Date(now.getTime() + 15 * 60 * 1_000);

          console.log({now, notifyTime})

          const scheduledRides = await prisma.ride.findMany({
            where: {
              status:      RideStatus.REQUESTED,
              driverId:    null,
              scheduledAt: {
                gte: new Date(notifyTime.getTime() - 60 * 1_000),
                lte: new Date(notifyTime.getTime() + 60 * 1_000),
              },
              isDeleted: false
            },
          });

          if (!isManagerReady() || scheduledRides.length === 0) return;

          for (const ride of scheduledRides) {
            const notified = await broadcastToNearbyDrivers(
              [ride.pickupLng ?? 0, ride.pickupLat ?? 0],
              SocketEvents.RIDE_REQUESTED,
              {
                rideId:          ride.id,
                vehicleCategory: ride.vehicleCategory,
                serviceType:     ride.serviceType,
                pickupLocation: {
                  address:     ride.pickupAddress,
                  coordinates: [ride.pickupLng ?? 0, ride.pickupLat ?? 0],
                },
                dropoffLocation: {
                  address:     ride.dropoffAddress,
                  coordinates: [ride.dropoffLng ?? 0, ride.dropoffLat ?? 0],
                },
                estimatedFare: ride.estimatedFare,
                totalFare:     ride.totalFare,
                distanceKm:    ride.distanceKm,
                scheduledAt:   ride.scheduledAt,
              },
            );

            logger.info(`[CRON] Scheduled ride ${ride.id} — notified ${notified.length} drivers`);
          }
        } catch (err) {
          logger.error('[CRON] Scheduled-ride notification error:', err);
        }
      });
    });
  } catch (err) {
    logger.error('Error starting the server:', err);
  }
}

main();

process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled rejection: ${err}`);
  if (server) server.close(() => process.exit(1));
  else process.exit(1);
});

process.on('uncaughtException', (err) => {
  logger.error(`Uncaught exception: ${err}`);
  if (server) server.close(() => process.exit(1));
  else process.exit(1);
});
