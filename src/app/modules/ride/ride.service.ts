import { RideStatus, CancellationActor, Prisma } from '@prisma/client';
import prisma from '../../config/prisma';
import {
  isManagerReady,
  broadcastRideRequestToNearbyDrivers,
  getOnlineDriverEntry,
  emitToPassenger,
  emitToDriver,
  emitToRideRoom,
  setDriverOnRide,
} from '../../../socket/socket.manager';
import { getDistanceKm, recalculateFare } from './ride.utils';
import { SocketEvents } from '../../../socket/socket.types';
import { logger } from '../../utils/logger';
import { sendFcmToNearbyDrivers, sendNotificationByFcmToken } from '../../utils/sentNotificationByFcmToken';
import { saveNotification, saveNotificationToDriversByProfileId } from '../notifications/notifications.utils';
import { AVERAGE_SPEED_KMH, ILocation, NearestRidesProps, IReviewEntry, TRideCreate } from './ride.interface';
import AppError from '../../error/AppError';
import httpStatus from 'http-status';
import { PaymentService } from '../payment/payment.service';
import { recordWalletTransaction } from '../wallet/wallet.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

const buildPagination = (query: Record<string, unknown>) => {
  const page  = Math.max(1, Number(query.page)  || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

const generateRideId = async (): Promise<string> => {
  while (true) {
    const digits    = Math.floor(1000 + Math.random() * 9000);
    const candidate = `#MN${digits}`;
    const exists    = await prisma.ride.findUnique({ where: { rideId: candidate } });
    if (!exists) return candidate;
  }
};

// ── Ride select fragments ─────────────────────────────────────────────────────

const passengerSelect = {
  id: true, name: true, profileImage: true, phoneNumber: true,
  averageRating: true, totalReview: true, countryCode: true,
} satisfies Prisma.UserSelect;

const driverInclude = {
  user: {
    select: {
      id: true, name: true, profileImage: true,
      phoneNumber: true, countryCode: true,
      averageRating: true, totalReview: true,
    },
  },
} satisfies Prisma.DriverProfileInclude;

// ─────────────────────────────────────────────────────────────────────────────

const createRide = async (payload: any) => {

  const passengerId = payload.passenger;
  const pickupAddress = payload.pickupLocation?.address;
  const pickupCoords = payload.pickupLocation?.location?.coordinates || [];
  const pickupLng = pickupCoords[0];
  const pickupLat = pickupCoords[1];
  
  const dropoffAddress = payload.dropoffLocation?.address;
  const dropoffCoords = payload.dropoffLocation?.location?.coordinates || [];
  const dropoffLng = dropoffCoords[0];
  const dropoffLat = dropoffCoords[1];
  
  // Required field validation
  if (!passengerId) {
    throw new Error('passengerId is required');
  }
  if (!pickupAddress || pickupLat === undefined || pickupLng === undefined) {
    throw new Error('Pickup location is required');
  }
  if (!dropoffAddress || dropoffLat === undefined || dropoffLng === undefined) {
    throw new Error('Dropoff location is required');
  }


  console.log("create ride payload =>>>> ", payload);
  const rideId = await generateRideId();

 console.log("rideId from create ride =>>>> ", rideId);

let ride;
 try {
    ride = await prisma.ride.create({
    data: {
      rideId,
      country:         payload.country.toUpperCase(),
      passengerId,
      serviceType:     payload.serviceType,
      vehicleCategory: payload.vehicleCategory,

      pickupAddress,
      pickupLat,
      pickupLng,

      dropoffAddress,
      dropoffLat,
      dropoffLng,

      paymentMethod:   payload.paymentMethod,
      distanceKm:      payload.distanceKm   || 0,
      durationMin:     payload.durationMin  || 0,
      estimatedFare:   payload.estimatedFare || 0,
      totalFare:       payload.totalFare    || 0,
      driverEarning:   payload.driverEarning || 0,
      adminCommission: payload.adminCommission || 0,

      pickupType:  payload.pickupType,
      scheduledAt: payload.scheduledAt ?? null,

      statusHistory: {
        create: [{ status: RideStatus.REQUESTED }],
      },

      ...(payload.parcelDetails && {
        parcelDetails: {
          create: {
            itemType:       payload.parcelDetails.itemType,
            approxWeightKg: payload.parcelDetails.approxWeightKg,
            isFragile:      payload.parcelDetails.isFragile,
            notes:          payload.parcelDetails.notes ?? '',
            instructions:   payload.parcelDetails.instructions ?? '',
            receiverName:   payload.parcelDetails.receiverName,
            receiverPhone:  payload.parcelDetails.receiverPhone,
          },
        },
      }),
    },
    include: {
      parcelDetails:  true,
      statusHistory:  true,
    },
  });
 } catch (error) {
   console.log("error from create ride =>>>>>>>> ", error)
   return;
 }



  // Socket + FCM: notify nearby online drivers
  try {
    if (isManagerReady()) {
      const passenger = await prisma.user.findUnique({
        where:  { id: payload.passenger },
        select: { name: true, profileImage: true, averageRating: true, phoneNumber: true, countryCode: true },
      });

      const notifiedDriverIds = await broadcastRideRequestToNearbyDrivers(
        [ride.pickupLng ?? 0, ride.pickupLat ?? 0],
        {
          rideId:                 ride.id,
          passengerId:            ride.passengerId,
          passengerName:          passenger?.name            ?? '',
          passengerProfileImage:  passenger?.profileImage   ?? '',
          passengerAverageRating: passenger?.averageRating  ?? 0,
          countryCode:            passenger?.countryCode    ?? '',
          passengerPhone:         passenger?.phoneNumber    ?? '',
          vehicleCategory:        ride.vehicleCategory,
          serviceType:            ride.serviceType,
          pickupLocation: {
            address:     ride.pickupAddress ?? '',
            coordinates: [ride.pickupLng ?? 0, ride.pickupLat ?? 0],
          },
          dropoffLocation: {
            address:     ride.dropoffAddress ?? '',
            coordinates: [ride.dropoffLng ?? 0, ride.dropoffLat ?? 0],
          },
          estimatedFare: ride.estimatedFare,
          totalFare:     ride.totalFare,
          distanceKm:    ride.distanceKm,
          scheduledAt:   ride.scheduledAt,
          pickupType:    ride.pickupType,
          parcelDetails: ride.parcelDetails ?? undefined,
          paymentMethod: ride.paymentMethod,
        },
      );

      sendFcmToNearbyDrivers(
        notifiedDriverIds,
        'New Ride Request',
        `Pickup: ${ride.pickupAddress}`,
      ).catch((err) => logger.warn('createRide: FCM to drivers failed:', err));

      saveNotificationToDriversByProfileId(notifiedDriverIds, {
        senderId:    ride.passengerId,
        senderName:  passenger?.name ?? '',
        senderImage: passenger?.profileImage ?? '',
        text:        `New ride request from ${passenger?.name ?? 'a passenger'}. Pickup: ${ride.pickupAddress}`,
        type:        'newRideRequest',
      });
    }
  } catch (err) {
    logger.warn('createRide: socket emission failed (non-critical):', err);
  }

  return ride;
};

// ─────────────────────────────────────────────────────────────────────────────

const driverAcceptRide = async (
  rideId:  string,
  driverId: string,
  lat?:    number,
  lng?:    number,
) => {

  console.log("driver accept ride =>>>> ", {rideId, driverId, lat, lng})
  // Only accept rides that haven't been taken yet
  const existing = await prisma.ride.findFirst({ where: { id: rideId, driverId: null } });
  if (!existing) throw new Error('Ride not found or already accepted');

  const ride = await prisma.ride.update({
    where: { id: rideId },
    data: {
      driverId:         driverId,
      driverAcceptedAt: new Date(),
      status:           RideStatus.ACCEPTED,
      statusHistory: {
        create: [{ status: RideStatus.ACCEPTED }],
      },
    },
    include: {
      parcelDetails: true,
      statusHistory: true,
    },
  });

  // Update driver's current location if provided
  if (lat !== undefined && lng !== undefined) {
    await prisma.driverProfile.update({
      where: { id: driverId },
      data:  { currentLat: lat, currentLng: lng },
    });
  }

  try {
    if (isManagerReady()) {
      const driverDoc = await prisma.driverProfile.findUnique({
        where:   { id: driverId },
        select: {
          vehicleBrand: true, vehicleModel: true, vehicleType: true,
          licenseNumber: true, currentLat: true, currentLng: true,
          averageRating: true, totalTrips: true, createdAt: true,
          user: { select: { name: true, profileImage: true, averageRating: true, phoneNumber: true, countryCode: true } },
        },
      });

      // How long driver has been on platform
      const joinedAt     = driverDoc?.createdAt;
      const diffMs       = joinedAt ? Date.now() - new Date(joinedAt).getTime() : 0;
      const diffDays     = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const totalMonths  = Math.floor(diffDays / 30.44);
      const years        = Math.floor(totalMonths / 12);
      const months       = totalMonths % 12;

      let driverExperience: string;
      if (diffDays < 30)           driverExperience = diffDays <= 1 ? '1 day' : `${diffDays} days`;
      else if (totalMonths < 12)   driverExperience = totalMonths === 1 ? '1 month' : `${totalMonths} months`;
      else if (months === 0)       driverExperience = years === 1 ? '1 year' : `${years} years`;
      else                         driverExperience = `${years}.${months} year`;

      const driverLat = lat
        ?? getOnlineDriverEntry(driverId)?.location?.[1]
        ?? driverDoc?.currentLat ?? 0;
      const driverLng = lng
        ?? getOnlineDriverEntry(driverId)?.location?.[0]
        ?? driverDoc?.currentLng ?? 0;

      const distanceToPickupKm  = getDistanceKm(ride.pickupLat ?? 0, ride.pickupLng ?? 0, driverLat, driverLng);
      const speed               = AVERAGE_SPEED_KMH[driverDoc?.vehicleType ?? ''] ?? 40;
      const estimatedArrivalMin = Math.ceil((distanceToPickupKm / speed) * 60);

      const payload = {
        rideId:              ride.id,
        status:              'ACCEPTED',
        changedAt:           new Date(),
        driverProfileId:     driverId,
        driverName:          driverDoc?.user?.name              ?? '',
        driverProfileImage:  driverDoc?.user?.profileImage      ?? '',
        driverAverageRating: driverDoc?.averageRating           ?? driverDoc?.user?.averageRating ?? 0,
        driverPhoneNumber:   driverDoc?.user?.phoneNumber       ?? '',
        driverCountryCode:   driverDoc?.user?.countryCode       ?? '',
        vehicleBrand:        driverDoc?.vehicleBrand            ?? '',
        vehicleModel:        driverDoc?.vehicleModel            ?? '',
        vehicleType:         driverDoc?.vehicleType             ?? '',
        licenseNumber:       driverDoc?.licenseNumber           ?? '',
        driverCurrentLocation: { lat: driverLat, lng: driverLng },
        pickupLocation:  { address: ride.pickupAddress,  lat: ride.pickupLat,  lng: ride.pickupLng  },
        dropoffLocation: { address: ride.dropoffAddress, lat: ride.dropoffLat, lng: ride.dropoffLng },
        totalFare:           ride.totalFare,
        paymentMethod:       ride.paymentMethod,
        estimatedArrivalMin,
        totalRides:          driverDoc?.totalTrips ?? 0,
        driverExperience,
        acceptedAt:          ride.driverAcceptedAt,
        serviceType:         ride.serviceType,
        pickupType:          ride.pickupType,
      };

      const statusPayload = { rideId: ride.id, status: 'ACCEPTED', changedAt: new Date(), serviceType: ride.serviceType, pickupType: ride.pickupType };

      emitToRideRoom(rideId, SocketEvents.RIDE_STATUS_UPDATED, statusPayload);
      emitToPassenger(ride.passengerId, SocketEvents.RIDE_STATUS_UPDATED, payload);
      emitToPassenger(ride.passengerId, SocketEvents.RIDE_ACCEPTED, payload);
      emitToRideRoom(rideId, SocketEvents.RIDE_ACCEPTED, payload);

      sendNotificationByFcmToken(
        ride.passengerId,
        `${driverDoc?.user?.name ?? 'Your driver'} accepted your ride. They are on the way!`,
        'Ride Accepted',
      ).catch((err) => logger.warn('driverAcceptRide: FCM to passenger failed:', err));

      saveNotification({
        senderId:    driverId,
        receiverId:  ride.passengerId,
        senderName:  driverDoc?.user?.name  ?? '',
        senderImage: driverDoc?.user?.profileImage ?? '',
        text:        `${driverDoc?.user?.name ?? 'Your driver'} accepted your ride. They are on the way!`,
        type:        'rideAccepted',
      });
    }
  } catch (err) {
    logger.warn('driverAcceptRide: socket emission failed (non-critical):', err);
  }

  return ride;
};

// ─────────────────────────────────────────────────────────────────────────────

const updateRideStatus = async (rideId: string, status: RideStatus) => {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new Error('Ride not found');

  const saved = await prisma.ride.update({
    where: { id: rideId },
    data: {
      status,
      statusHistory: { create: [{ status }] },
    },
  });

  try {
    if (isManagerReady()) {
      const statusPayload = {
        rideId:    saved.id,
        status,
        changedAt: new Date(),
        serviceType: saved.serviceType,
        pickupType:  saved.pickupType,
      };

      emitToRideRoom(rideId, SocketEvents.RIDE_STATUS_UPDATED, statusPayload);
      emitToPassenger(saved.passengerId, SocketEvents.RIDE_STATUS_UPDATED, statusPayload);

      const statusMessages: Partial<Record<RideStatus, string>> = {
        ACCEPTED:  'Your ride has been accepted. Driver is on the way!',
        ONGOING:   'Your ride has started. Enjoy your trip!',
        COMPLETED: 'Your ride is completed. Thank you for riding with us!',
        CANCELLED: 'Your ride has been cancelled.',
      };
      const statusNotifType: Partial<Record<RideStatus, { type: Parameters<typeof saveNotification>[0]['type']; text: string }>> = {
        ONGOING:   { type: 'rideStarted',   text: 'Your ride has started. Enjoy your trip!' },
        COMPLETED: { type: 'rideCompleted', text: 'Your ride is completed. Thank you for riding with us!' },
        CANCELLED: { type: 'tripCancelled', text: 'Your ride has been cancelled.' },
      };

      const fcmBody = statusMessages[status];
      if (fcmBody) {
        sendNotificationByFcmToken(saved.passengerId, fcmBody, 'Mino Ride')
          .catch((err) => logger.warn('updateRideStatus: FCM to passenger failed:', err));
      }

      const notifEntry = statusNotifType[status];
      if (notifEntry && saved.driverId) {
        saveNotification({
          senderId:   saved.driverId,
          receiverId: saved.passengerId,
          text:       notifEntry.text,
          type:       notifEntry.type,
        });
      }

      if (status === RideStatus.ONGOING) {
        emitToRideRoom(rideId, SocketEvents.RIDE_STARTED, statusPayload);
        emitToPassenger(saved.passengerId, SocketEvents.RIDE_STARTED, statusPayload);
      } else if (status === RideStatus.COMPLETED) {
        emitToRideRoom(rideId, SocketEvents.RIDE_COMPLETED, statusPayload);
        emitToPassenger(saved.passengerId, SocketEvents.RIDE_COMPLETED, statusPayload);
        if (saved.driverId) setDriverOnRide(saved.driverId, false);

        if (saved.paymentMethod === 'CASH' && saved.driverId) {
          PaymentService.createPayment({
            rideId:        saved.id,
            passengerId:   saved.passengerId,
            driverId:      saved.driverId,
            amount:        saved.totalFare ?? 0,
            tip:           saved.tip ?? 0,
            paymentMethod: 'CASH',
          }).catch((err) => logger.warn('updateRideStatus: CASH payment record creation failed:', err));
        }
      }
    }
  } catch (err) {
    logger.warn('updateRideStatus: socket emission failed (non-critical):', err);
  }

  return saved;
};

// ─────────────────────────────────────────────────────────────────────────────

const getMyRides = async (
  id:   string,
  role: 'passenger' | 'driver',
  query: Record<string, unknown>,
) => {
  const { skip, take, page, limit } = buildPagination(query);
  const isDriver = role === 'driver';
  const where: Prisma.RideWhereInput = {
    ...(isDriver ? { driverId: id } : { passengerId: id }),
    isDeleted: false,
  };

  const [result, total] = await Promise.all([
    prisma.ride.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: isDriver
        ? { passenger: { select: passengerSelect }, parcelDetails: true }
        : { driver: { include: driverInclude }, parcelDetails: true },
    }),
    prisma.ride.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

// ─────────────────────────────────────────────────────────────────────────────

interface EstimateRideOptionsSimpleProps {
  distanceKm: number;
  country:    string;
}

const estimateRideOptions = async ({ distanceKm, country }: EstimateRideOptionsSimpleProps) => {
  if (!distanceKm || isNaN(Number(distanceKm))) {
    throw new Error('Invalid distanceKm value');
  }

  distanceKm = Number(distanceKm);

  

  const fare = await prisma.fare.findFirst({ where: { country: country.toUpperCase() || "BANGLADESH", isActive: true } });
  if (!fare) throw new Error('Fare configuration not found for this country');

  const vehicleConfigs = [
    { vehicleType: 'MINO_GO',      baseFee: fare.minoGoBaseFee,   bookingFee: fare.minoGoBookingFee,   ratePerKm: fare.minoGoRatePerKm,   minimumFare: fare.minoGoMinimumFare },
    { vehicleType: 'MINO_COMFORT', baseFee: fare.minoGoBaseFee,   bookingFee: fare.minoGoBookingFee,   ratePerKm: fare.minoGoRatePerKm,   minimumFare: fare.minoGoMinimumFare },
    { vehicleType: 'MINO_XL',      baseFee: fare.minoXLBaseFee,   bookingFee: fare.minoXLBookingFee,   ratePerKm: fare.minoXLRatePerKm,   minimumFare: fare.minoXLMinimumFare },
    { vehicleType: 'MINO_MOTO',    baseFee: fare.minoMotoBaseFee, bookingFee: fare.minoMotoBookingFee, ratePerKm: fare.minoMotoRatePerKm, minimumFare: fare.minoMotoMinimumFare },
  ];

  return vehicleConfigs.map(({ vehicleType, baseFee, bookingFee, ratePerKm, minimumFare }) => {
    let estimatedFare = baseFee + bookingFee + ratePerKm * distanceKm;
    if (estimatedFare < minimumFare) estimatedFare = minimumFare;

    let totalFare = estimatedFare;
    if (fare.surchargeEnabled)     totalFare += fare.surchargeValue;
    if (fare.waitingChargeEnabled) totalFare += fare.waitingChargeRate * fare.waitingChargeGracePeriod;

    const adminCommission = (totalFare * fare.platformCommissionPercentage) / 100;
    const driverEarning   = totalFare - adminCommission;
    const speed           = AVERAGE_SPEED_KMH[vehicleType] || 40;
    const estimatedArrivalTimeMin = Math.ceil((distanceKm / speed) * 60);

    return {
      vehicleType,
      estimatedFare:          Math.round(estimatedFare),
      totalFare:              Math.round(totalFare),
      driverEarning:          Math.round(driverEarning),
      adminCommission:        Math.round(adminCommission),
      estimatedArrivalTimeMin,
      isAvailable:            true,
    };
  });
};

// ─────────────────────────────────────────────────────────────────────────────

const applyPromoToRide = async (rideId: string, promoCode: string) => {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new Error('Ride not found');
  if (!ride.totalFare || ride.totalFare <= 0) throw new Error('Ride totalFare is not set yet');

  const promo = await prisma.promo.findFirst({
    where: {
      title:          promoCode,
      status:         'ACTIVE',
      expirationDate: { gte: new Date() },
      isDeleted:      false,
    },
  });
  if (!promo) throw new Error('Invalid or expired promo code');
  if (ride.totalFare < promo.minimumSpend) {
    throw new Error(`Ride must cost at least ${promo.minimumSpend} to use this promo`);
  }

  const fare = await prisma.fare.findFirst({ where: { country: ride.country, isActive: true } });
  if (!fare) throw new Error('Fare configuration not found for this country');

  const discount       = Math.min(promo.discount, ride.totalFare);
  const newTotalFare   = ride.totalFare - discount;
  const adminCommission = (newTotalFare * fare.platformCommissionPercentage) / 100;
  const driverEarning  = newTotalFare - adminCommission;

  const saved = await prisma.ride.update({
    where: { id: rideId },
    data: {
      promoId:         promo.id,
      promoDiscount:   discount,
      totalFare:       newTotalFare,
      adminCommission: Math.round(adminCommission),
      driverEarning:   Math.round(driverEarning),
    },
  });

  const result = {
    rideId:          saved.id,
    estimatedFare:   saved.estimatedFare,
    totalFare:       saved.totalFare,
    promoDiscount:   saved.promoDiscount,
    driverEarning:   saved.driverEarning,
    adminCommission: saved.adminCommission,
    promoApplied:    promo.title,
  };

  try {
    if (isManagerReady()) {
      emitToPassenger(saved.passengerId, SocketEvents.PROMO_APPLIED, {
        rideId:          saved.id,
        promoCode:       promo.title,
        promoDiscount:   saved.promoDiscount,
        totalFare:       saved.totalFare,
        driverEarning:   saved.driverEarning,
        adminCommission: saved.adminCommission,
      });
    }
  } catch (err) {
    logger.warn('applyPromoToRide: socket emission failed (non-critical):', err);
  }

  return result;
};

// ─────────────────────────────────────────────────────────────────────────────

const endRide = async (
  rideId:          string,
  driverId:        string,
  dropoffLocation: ILocation,
) => {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, 'Ride not found');
  if (ride.driverId !== driverId) throw new AppError(httpStatus.FORBIDDEN, 'You are not the driver of this ride');
  if (ride.status !== RideStatus.ONGOING) throw new AppError(httpStatus.BAD_REQUEST, `Cannot end ride in status: ${ride.status}`);

  const actualDistanceKm = getDistanceKm(
    ride.pickupLat ?? 0, ride.pickupLng ?? 0,
    dropoffLocation.lat, dropoffLocation.lng,
  );
  const speed          = AVERAGE_SPEED_KMH[ride.vehicleCategory] ?? 40;
  const actualDurationMin = Math.ceil((actualDistanceKm / speed) * 60);

  const fares = await recalculateFare({
    country:          ride.country,
    vehicleCategory:  ride.vehicleCategory,
    actualDistanceKm,
    promoDiscount:    ride.promoDiscount,
  });

  const saved = await prisma.ride.update({
    where: { id: rideId },
    data: {
      status:               RideStatus.END_RIDE,
      actualDropoffAddress: dropoffLocation.address,
      actualDropoffLat:     dropoffLocation.lat,
      actualDropoffLng:     dropoffLocation.lng,
      distanceKm:           Math.round(actualDistanceKm * 100) / 100,
      durationMin:          actualDurationMin,
      estimatedFare:        fares.estimatedFare,
      totalFare:            fares.totalFare,
      adminCommission:      fares.adminCommission,
      driverEarning:        fares.driverEarning,
      statusHistory:        { create: [{ status: RideStatus.END_RIDE }] },
    },
  });

  try {
    if (isManagerReady()) {
      const endPayload = {
        rideId: saved.id,
        actualDropoffLocation: { address: dropoffLocation.address, lat: dropoffLocation.lat, lng: dropoffLocation.lng },
        distanceKm:      saved.distanceKm,
        durationMin:     saved.durationMin,
        estimatedFare:   saved.estimatedFare,
        totalFare:       saved.totalFare,
        driverEarning:   saved.driverEarning,
        adminCommission: saved.adminCommission,
        changedAt:       new Date(),
      };
      const statusPayload = { rideId: saved.id, status: 'END_RIDE', changedAt: new Date(), serviceType: saved.serviceType, pickupType: saved.pickupType };
      emitToRideRoom(rideId, SocketEvents.RIDE_ENDED, endPayload);
      emitToRideRoom(rideId, SocketEvents.RIDE_STATUS_UPDATED, statusPayload);
      emitToPassenger(saved.passengerId, SocketEvents.RIDE_ENDED, endPayload);
      emitToPassenger(saved.passengerId, SocketEvents.RIDE_STATUS_UPDATED, statusPayload);
    }
  } catch (err) {
    logger.warn('endRide: socket emission failed (non-critical):', err);
  }

  return saved;
};

// ─────────────────────────────────────────────────────────────────────────────

const arrivedDropoff = async (
  rideId:          string,
  driverId:        string,
  dropoffLocation: ILocation,
) => {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, 'Ride not found');
  if (ride.driverId !== driverId) throw new AppError(httpStatus.FORBIDDEN, 'You are not the driver of this ride');
  if (ride.status !== RideStatus.ONGOING) throw new AppError(httpStatus.BAD_REQUEST, `Cannot arrive at dropoff in status: ${ride.status}`);

  const actualDistanceKm = getDistanceKm(
    ride.pickupLat ?? 0, ride.pickupLng ?? 0,
    dropoffLocation.lat, dropoffLocation.lng,
  );
  const speed         = AVERAGE_SPEED_KMH[ride.vehicleCategory] ?? 40;
  const actualDurationMin = Math.ceil((actualDistanceKm / speed) * 60);

  
  const fares = await recalculateFare({
    country:          ride.country || "BANGLADESH",
    vehicleCategory:  ride.vehicleCategory,
    actualDistanceKm,
    promoDiscount:    ride.promoDiscount,
  });

  const saved = await prisma.ride.update({
    where: { id: rideId },
    data: {
      status:          RideStatus.ARRIVED_DROPOFF,
      dropoffAddress:  dropoffLocation.address,
      dropoffLat:      dropoffLocation.lat,
      dropoffLng:      dropoffLocation.lng,
      distanceKm:      Math.round(actualDistanceKm * 100) / 100,
      durationMin:     actualDurationMin,
      estimatedFare:   fares.estimatedFare,
      totalFare:       fares.totalFare,
      adminCommission: fares.adminCommission,
      driverEarning:   fares.driverEarning,
      statusHistory:   { create: [{ status: RideStatus.ARRIVED_DROPOFF }] },
    },
  });

  try {
    if (isManagerReady()) {
      const arrivedPayload = {
        rideId: saved.id,
        dropoffLocation: { address: dropoffLocation.address, lat: dropoffLocation.lat, lng: dropoffLocation.lng },
        distanceKm:      saved.distanceKm,
        durationMin:     saved.durationMin,
        estimatedFare:   saved.estimatedFare,
        totalFare:       saved.totalFare,
        driverEarning:   saved.driverEarning,
        adminCommission: saved.adminCommission,
        changedAt:       new Date(),
        serviceType:     saved.serviceType,
        pickupType:      saved.pickupType,
      };
      const statusPayload = { rideId: saved.id, status: 'ARRIVED_DROPOFF', changedAt: new Date(), serviceType: saved.serviceType, pickupType: saved.pickupType };
      emitToRideRoom(rideId, SocketEvents.RIDE_ENDED, arrivedPayload);
      emitToRideRoom(rideId, SocketEvents.RIDE_STATUS_UPDATED, statusPayload);
      emitToPassenger(saved.passengerId, SocketEvents.RIDE_ENDED, arrivedPayload);
      emitToPassenger(saved.passengerId, SocketEvents.RIDE_STATUS_UPDATED, statusPayload);
    }
  } catch (err) {
    logger.warn('arrivedDropoff: socket emission failed (non-critical):', err);
  }

  return saved;
};

// ─────────────────────────────────────────────────────────────────────────────

const confirmDropoff = async (rideId: string, driverId: string) => {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });

  if (!ride) throw new AppError(httpStatus.NOT_FOUND, 'Ride not found');

  if (ride.driverId !== driverId) throw new AppError(httpStatus.FORBIDDEN, 'You are not the driver of this ride');
  
  if (ride.status !== RideStatus.END_RIDE && ride.status !== RideStatus.ARRIVED_DROPOFF) {
    throw new AppError(httpStatus.BAD_REQUEST, `Cannot confirm dropoff in status: ${ride.status}`);
  }

  const saved = await prisma.ride.update({
    where: { id: rideId },
    data: {
      status:       RideStatus.CONFIRM_DROPOFF,
      statusHistory: { create: [{ status: RideStatus.CONFIRM_DROPOFF }] },
    },
  });

  try {
    if (isManagerReady()) {
      const payload = {
        rideId:          saved.id,
        pickupLocation:  { address: saved.pickupAddress,  lat: saved.pickupLat,  lng: saved.pickupLng  },
        dropoffLocation: { address: saved.dropoffAddress, lat: saved.dropoffLat, lng: saved.dropoffLng },
        distanceKm:      saved.distanceKm,
        durationMin:     saved.durationMin,
        estimatedFare:   saved.estimatedFare,
        totalFare:       saved.totalFare,
        driverEarning:   saved.driverEarning,
        adminCommission: saved.adminCommission,
        promoDiscount:   saved.promoDiscount,
        paymentMethod:   saved.paymentMethod,
        changedAt:       new Date(),
        serviceType:     saved.serviceType,
        pickupType:      saved.pickupType,
      };
      const confirmStatusPayload = { rideId: saved.id, status: 'CONFIRM_DROPOFF', changedAt: new Date(), serviceType: saved.serviceType, pickupType: saved.pickupType };
      emitToRideRoom(rideId, SocketEvents.RIDE_CONFIRM_DROPOFF, payload);
      emitToPassenger(saved.passengerId, SocketEvents.RIDE_CONFIRM_DROPOFF, payload);
      emitToRideRoom(rideId, SocketEvents.RIDE_STATUS_UPDATED, confirmStatusPayload);
      emitToPassenger(saved.passengerId, SocketEvents.RIDE_STATUS_UPDATED, confirmStatusPayload);
    }
  } catch (err) {
    logger.warn('confirmDropoff: socket emission failed (non-critical):', err);
  }

  return saved;
};

// ─────────────────────────────────────────────────────────────────────────────

const payRide = async (rideId: string, passengerId: string, tip = 0) => {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride)                             throw new AppError(httpStatus.NOT_FOUND,  'Ride not found');
  if (ride.passengerId !== passengerId)  throw new AppError(httpStatus.FORBIDDEN,  'You are not the passenger of this ride');
  if (ride.status !== RideStatus.CONFIRM_DROPOFF) throw new AppError(httpStatus.BAD_REQUEST, `Payment not allowed in status: ${ride.status}`);
  if (ride.paymentMethod !== 'CASH')     throw new AppError(httpStatus.BAD_REQUEST, 'This endpoint is only for CASH payments.');
  if (ride.paymentStatus === 'PAID')     throw new AppError(httpStatus.CONFLICT,   'Ride already paid');

  const tipAmount    = Math.max(0, Math.round(tip));
  const newTotalFare = (ride.totalFare ?? 0) + tipAmount;

  const fare = await prisma.fare.findFirst({ where: { country: ride.country, isActive: true } });
  const commissionPct   = fare?.platformCommissionPercentage ?? 0;
  const adminCommission = Math.round(((ride.totalFare ?? 0) * commissionPct) / 100);
  const driverEarning   = Math.round(newTotalFare - adminCommission);

  const saved = await prisma.ride.update({
    where: { id: rideId },
    data: {
      tip:             tipAmount,
      totalFare:       newTotalFare,
      adminCommission,
      driverEarning,
      paymentStatus:   'PAID',
      status:          RideStatus.COMPLETED,
      statusHistory:   { create: [{ status: RideStatus.COMPLETED }] },
    },
  });

  // CASH: deduct admin commission from driver wallet
  if (saved.driverId) {
    prisma.driverProfile.update({
      where: { id: saved.driverId },
      data:  {
        walletBalance:  { decrement: adminCommission },
        totalEarnings:  { increment: driverEarning },
        totalTrips:     { increment: 1 },
      },
    }).catch((err) => logger.warn('payRide: driver wallet debit failed:', err));

    if (adminCommission > 0) {
      prisma.driverProfile.findUnique({ where: { id: saved.driverId }, select: { userId: true } })
        .then((dp) => {
          if (dp) {
            recordWalletTransaction({
              userId:      dp.userId,
              type:        'DEBIT',
              source:      'ADMIN_COMMISSION',
              amount:      adminCommission,
              description: `Platform commission for ride #${saved.rideId ?? saved.id}`,
              rideId:      saved.id,
            }).catch((err) => logger.warn('payRide: commission wallet tx failed:', err));
          }
        })
        .catch((err) => logger.warn('payRide: driver lookup for wallet tx failed:', err));
    }
  }

  try {
    await PaymentService.createPayment({
      rideId:        saved.id,
      passengerId:   saved.passengerId,
      driverId:      saved.driverId!,
      amount:        saved.totalFare ?? 0,
      tip:           tipAmount,
      paymentMethod: 'CASH',
    });
  } catch (err) {
    logger.warn('payRide: payment record creation failed (non-critical):', err);
  }

  try {
    if (isManagerReady()) {
      const paidPayload = {
        rideId: saved.id, tip: tipAmount, totalFare: saved.totalFare,
        driverEarning: saved.driverEarning, adminCommission: saved.adminCommission,
        paymentStatus: 'PAID', changedAt: new Date(),
        serviceType: saved.serviceType, pickupType: saved.pickupType,
      };
      emitToRideRoom(rideId, SocketEvents.RIDE_COMPLETED, paidPayload);
      emitToRideRoom(rideId, SocketEvents.RIDE_STATUS_UPDATED, { rideId: saved.id, status: 'COMPLETED', changedAt: new Date(), serviceType: saved.serviceType, pickupType: saved.pickupType });
      if (saved.driverId) {
        emitToDriver(saved.driverId, SocketEvents.RIDE_COMPLETED, paidPayload);
        setDriverOnRide(saved.driverId, false);
      }
    }
  } catch (err) {
    logger.warn('payRide: socket emission failed (non-critical):', err);
  }

  return saved;
};

// ─────────────────────────────────────────────────────────────────────────────

const collectCashPayment = async (rideId: string, driverId: string, tip = 0) => {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride)                             throw new AppError(httpStatus.NOT_FOUND,  'Ride not found');
  if (ride.driverId !== driverId)        throw new AppError(httpStatus.FORBIDDEN,  'You are not the driver of this ride');
  if (ride.paymentMethod !== 'CASH')     throw new AppError(httpStatus.BAD_REQUEST, 'This endpoint is only for CASH rides');
  if (ride.status !== RideStatus.CONFIRM_DROPOFF) throw new AppError(httpStatus.BAD_REQUEST, `Cannot collect payment in status: ${ride.status}`);
  if (ride.paymentStatus === 'PAID')     throw new AppError(httpStatus.CONFLICT,   'Payment already collected');

  const tipAmount       = Math.max(0, Math.round(tip));
  const subtotal        = ride.totalFare ?? 0;
  const newTotalFare    = subtotal + tipAmount;

  const fare            = await prisma.fare.findFirst({ where: { country: ride.country || "BANGLADESh", isActive: true } });
  const commissionPct   = fare?.platformCommissionPercentage ?? 0;
  const adminCommission = Math.round((subtotal * commissionPct) / 100);
  const driverEarning   = Math.round(newTotalFare - adminCommission);

  const saved = await prisma.ride.update({
    where: { id: rideId },
    data: {
      tip:             tipAmount,
      totalFare:       newTotalFare,
      adminCommission,
      driverEarning,
      paymentStatus:   'PAID',
      status:          RideStatus.COMPLETED,
      statusHistory:   { create: [{ status: RideStatus.COMPLETED }] },
    },
  });

  try {
    await prisma.driverProfile.update({
      where: { id: driverId },
      data:  {
        walletBalance: { decrement: adminCommission },
        totalEarnings: { increment: driverEarning },
        totalTrips:    { increment: 1 },
      },
    });

    const dp = await prisma.driverProfile.findUnique({ where: { id: driverId }, select: { userId: true } });
    if (dp && adminCommission > 0) {
      recordWalletTransaction({
        userId:      dp.userId,
        type:        'DEBIT',
        source:      'ADMIN_COMMISSION',
        amount:      adminCommission,
        description: `Platform commission for ride #${saved.rideId ?? saved.id}`,
        rideId:      saved.id,
      }).catch((err) => logger.warn('collectCashPayment: commission wallet tx failed:', err));
    }
  } catch (err) {
    logger.warn('collectCashPayment: driver wallet update failed:', err);
  }

  try {
    await PaymentService.createPayment({
      rideId:          saved.id,
      passengerId:     saved.passengerId,
      driverId:        saved.driverId!,
      amount:          saved.totalFare ?? 0,
      totalFare:       saved.totalFare ?? 0,
      driverEarning,
      adminCommission,
      promoDiscount:   saved.promoDiscount,
      tip:             tipAmount,
      paymentMethod:   'CASH',
    });
  } catch (err) {
    logger.warn('collectCashPayment: payment record creation failed (non-critical):', err);
  }

  try {
    if (isManagerReady()) {
      const payload = {
        rideId:          saved.id,
        pickupLocation:  { address: saved.pickupAddress,  lat: saved.pickupLat,  lng: saved.pickupLng  },
        dropoffLocation: { address: saved.dropoffAddress, lat: saved.dropoffLat, lng: saved.dropoffLng },
        distanceKm:      saved.distanceKm,
        durationMin:     saved.durationMin,
        estimatedFare:   saved.estimatedFare,
        totalFare:       saved.totalFare,
        tip:             tipAmount,
        status:          'COMPLETED',
        driverEarning:   saved.driverEarning,
        adminCommission: saved.adminCommission,
        promoDiscount:   saved.promoDiscount,
        paymentStatus:   'PAID',
        paymentMethod:   saved.paymentMethod,
        changedAt:       new Date(),
        serviceType:     saved.serviceType,
        pickupType:      saved.pickupType,
      };
      emitToRideRoom(rideId, SocketEvents.RIDE_COMPLETED, payload);
      emitToRideRoom(rideId, SocketEvents.RIDE_STATUS_UPDATED, { rideId: saved.id, status: 'COMPLETED', changedAt: new Date(), serviceType: saved.serviceType, pickupType: saved.pickupType });
      emitToPassenger(saved.passengerId, SocketEvents.RIDE_STATUS_UPDATED, payload);
      setDriverOnRide(saved.driverId!, false);
    }
  } catch (err) {
    logger.warn('collectCashPayment: socket emission failed (non-critical):', err);
  }

  return saved;
};

// ─────────────────────────────────────────────────────────────────────────────

const cancelRide = async (
  rideId:      string,
  cancelledBy: CancellationActor,
  reason:      string,
  details?:    string,
) => {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new Error('Ride not found');

  const saved = await prisma.ride.update({
    where: { id: rideId },
    data: {
      status:       RideStatus.CANCELLED,
      cancelledBy:  cancelledBy,
      reason,
      statusHistory:  { create: [{ status: RideStatus.CANCELLED }] },
      cancellations:  { create: [{ cancelledBy, reason, details }] },
    },
  });

  try {
    if (isManagerReady()) {
      const cancelPayload = { rideId: saved.id, cancelledBy, reason, details };
      emitToRideRoom(rideId, SocketEvents.RIDE_CANCELLED, cancelPayload);
      emitToPassenger(saved.passengerId, SocketEvents.RIDE_CANCELLED, cancelPayload);

      if (saved.driverId) {
        emitToDriver(saved.driverId, SocketEvents.RIDE_CANCELLED, cancelPayload);
        setDriverOnRide(saved.driverId, false);
      }
    }
  } catch (err) {
    logger.warn('cancelRide: socket emission failed (non-critical):', err);
  }

  return saved;
};

// ─────────────────────────────────────────────────────────────────────────────

const adminGetAllRides = async (query: Record<string, unknown>) => {
  const { skip, take, page, limit } = buildPagination(query);
  const searchTerm = query.searchTerm as string | undefined;

  const where: Prisma.RideWhereInput = {
    isDeleted: false,
    ...(searchTerm && {
      OR: [
        { rideId:      { contains: searchTerm, mode: 'insensitive' } },
        { status:      { equals: searchTerm.toUpperCase() as RideStatus } },
        { serviceType: { equals: searchTerm.toUpperCase() as any } },
      ],
    }),
  };

  const [result, total] = await Promise.all([
    prisma.ride.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        passenger: { select: { id: true, name: true, profileImage: true } },
        driver:    { include: { user: { select: { id: true, name: true, profileImage: true } } } },
      },
    }),
    prisma.ride.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

// ─────────────────────────────────────────────────────────────────────────────

const getNearestRides = async ({
  driverLat,
  driverLng,
  maxDistanceMeters = 5_000,
  now = new Date(),
}: NearestRidesProps) => {
  // Bounding-box pre-filter then Haversine sort
  const radiusKm = maxDistanceMeters / 1_000;
  const latDelta  = radiusKm / 111;
  const lngDelta  = radiusKm / (111 * Math.cos((driverLat * Math.PI) / 180));

  const candidates = await prisma.ride.findMany({
    where: {
      driverId:  null,
      status:    RideStatus.REQUESTED,
      isDeleted: false,
      OR: [
        { scheduledAt: null },
        { scheduledAt: { gte: now } },
      ],
      pickupLat: { gte: driverLat - latDelta, lte: driverLat + latDelta },
      pickupLng: { gte: driverLng - lngDelta, lte: driverLng + lngDelta },
    },
    take: 40,
    include: { parcelDetails: true },
  });

  return candidates
    .filter((r) => {
      if (r.pickupLat == null || r.pickupLng == null) return false;
      return getDistanceKm(driverLat, driverLng, r.pickupLat, r.pickupLng) * 1_000 <= maxDistanceMeters;
    })
    .slice(0, 20);
};

// ─────────────────────────────────────────────────────────────────────────────

const UPCOMING_STATUSES: RideStatus[] = [
  RideStatus.REQUESTED,
  RideStatus.ACCEPTED,
  RideStatus.ARRIVED_PICKUP,
  RideStatus.ONGOING,
  RideStatus.ARRIVED_DROPOFF,
];

type TRideStatusFilter = 'completed' | 'cancelled' | 'upcoming';

const getRidesByStatus = async (
  id:     string,
  role:   'passenger' | 'driver',
  status: TRideStatusFilter,
  query:  Record<string, unknown>,
) => {
  const { skip, take, page, limit } = buildPagination(query);
  const isDriver = role === 'driver';

  const where: Prisma.RideWhereInput = {
    ...(isDriver ? { driverId: id } : { passengerId: id }),
    isDeleted: false,
    ...(status === 'upcoming'
      ? { status: { in: UPCOMING_STATUSES } }
      : { status: status.toUpperCase() as RideStatus }),
  };

  const [result, total] = await Promise.all([
    prisma.ride.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: isDriver
        ? { passenger: { select: { id: true, name: true, profileImage: true, averageRating: true } } }
        : { driver:    { include: { user: { select: { id: true, name: true, profileImage: true } } } } },
    }),
    prisma.ride.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

// ─────────────────────────────────────────────────────────────────────────────

const getRecentRides = async (
  userId: string,
  role:   'passenger' | 'driver',
  query:  Record<string, unknown>,
) => {
  const { skip, take, page, limit } = buildPagination(query);
  const searchTerm = query.searchTerm as string | undefined;

  const where: Prisma.RideWhereInput = {
    ...(role === 'driver' ? { driverId: userId } : { passengerId: userId }),
    isDeleted: false,
    ...(searchTerm && {
      OR: [
        { status:      { equals: searchTerm.toUpperCase() as RideStatus } },
        { serviceType: { equals: searchTerm.toUpperCase() as any } },
      ],
    }),
  };

  const [result, total] = await Promise.all([
    prisma.ride.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      select: {
        id:              true,
        pickupAddress:   true,
        pickupLat:       true,
        pickupLng:       true,
        dropoffAddress:  true,
        dropoffLat:      true,
        dropoffLng:      true,
        status:          true,
        distanceKm:      true,
        durationMin:     true,
        createdAt:       true,
        scheduledAt:     true,
        pickupType:      true,
      },
    }),
    prisma.ride.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

// ─────────────────────────────────────────────────────────────────────────────

const submitRideReview = async (
  rideId:       string,
  reviewerRole: 'passenger' | 'driver',
  payload:      Pick<IReviewEntry, 'rating' | 'comment'>,
) => {
  const ride = await prisma.ride.findUnique({ where: { id: rideId } });
  if (!ride) throw new AppError(httpStatus.NOT_FOUND, 'Ride not found');

  const reviewableStatuses: RideStatus[] = [RideStatus.COMPLETED, RideStatus.CANCELLED, RideStatus.CONFIRM_DROPOFF];
  if (!reviewableStatuses.includes(ride.status)) {
    throw new AppError(httpStatus.BAD_REQUEST, 'Only completed, confirm_dropoff or cancelled rides can be reviewed');
  }

  if (reviewerRole === 'passenger') {
    if (ride.isPassengerReviewed) throw new AppError(httpStatus.CONFLICT, 'You have already reviewed this ride');

    const saved = await prisma.ride.update({
      where: { id: rideId },
      data: {
        passengerReviewRating:  payload.rating,
        passengerReviewComment: payload.comment ?? '',
        passengerReviewGivenAt: new Date(),
        isPassengerReviewed:    true,
      },
    });

    // Update driver's average rating
    if (ride.driverId) {
      const dp = await prisma.driverProfile.findUnique({ where: { id: ride.driverId }, select: { userId: true } });
      if (dp) {
        const user = await prisma.user.findUnique({
          where:  { id: dp.userId },
          select: { rating: true, totalReview: true },
        });
        if (user) {
          const newRating      = (user.rating ?? 0) + payload.rating;
          const newTotalReview = (user.totalReview ?? 0) + 1;
          await prisma.user.update({
            where: { id: dp.userId },
            data:  {
              rating:        newRating,
              totalReview:   newTotalReview,
              averageRating: newRating / newTotalReview,
            },
          });
        }
      }
    }

    return saved;
  } else {
    if (ride.isDriverReviewed) throw new AppError(httpStatus.CONFLICT, 'You have already reviewed this ride');

    const saved = await prisma.ride.update({
      where: { id: rideId },
      data: {
        driverReviewRating:  payload.rating,
        driverReviewComment: payload.comment ?? '',
        driverReviewGivenAt: new Date(),
        isDriverReviewed:    true,
      },
    });

    // Update passenger's average rating
    const passengerUser = await prisma.user.findUnique({
      where:  { id: ride.passengerId },
      select: { rating: true, totalReview: true },
    });
    if (passengerUser) {
      const newRating      = (passengerUser.rating ?? 0) + payload.rating;
      const newTotalReview = (passengerUser.totalReview ?? 0) + 1;
      await prisma.user.update({
        where: { id: ride.passengerId },
        data:  {
          rating:        newRating,
          totalReview:   newTotalReview,
          averageRating: newRating / newTotalReview,
        },
      });
    }

    return saved;
  }
};

// ─────────────────────────────────────────────────────────────────────────────

const getMyActiveRide = async (id: string, role: 'passenger' | 'driver') => {
  const where: Prisma.RideWhereInput = {
    ...(role === 'driver' ? { driverId: id } : { passengerId: id }),
    status: {
      in: [
        RideStatus.ACCEPTED,
        RideStatus.ARRIVED_PICKUP,
        RideStatus.ONGOING,
      ],
    },
    isDeleted: false,
  };

  return prisma.ride.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    include: role === 'driver'
      ? { passenger: { select: passengerSelect } }
      : { driver:    { include: driverInclude } },
  });
};

// ─────────────────────────────────────────────────────────────────────────────

const getRideReview = async (
  rideId:      string,
  requesterId: string,
  role:        'passenger' | 'driver',
) => {
  const ride = await prisma.ride.findUnique({
    where:  { id: rideId },
    select: {
      passengerId:            true,
      driverId:               true,
      passengerReviewRating:  true,
      passengerReviewComment: true,
      passengerReviewGivenAt: true,
      driverReviewRating:     true,
      driverReviewComment:    true,
      driverReviewGivenAt:    true,
      isPassengerReviewed:    true,
      isDriverReviewed:       true,
      status:                 true,
    },
  });

  if (!ride) throw new AppError(httpStatus.NOT_FOUND, 'Ride not found');

  const toReviewEntry = (rating: number | null, comment: string | null, givenAt: Date | null): IReviewEntry | null => {
    if (rating == null) return null;
    return { rating, comment: comment ?? '', givenAt: givenAt ?? new Date() };
  };

  if (role === 'passenger') {
    if (ride.passengerId !== requesterId) throw new AppError(httpStatus.FORBIDDEN, 'You are not the passenger of this ride');
    return {
      myReview:        toReviewEntry(ride.passengerReviewRating, ride.passengerReviewComment, ride.passengerReviewGivenAt),
      theirReview:     toReviewEntry(ride.driverReviewRating,    ride.driverReviewComment,    ride.driverReviewGivenAt),
      isReviewed:      ride.isPassengerReviewed,
      isTheirReviewed: ride.isDriverReviewed,
    };
  }

  if (ride.driverId !== requesterId) throw new AppError(httpStatus.FORBIDDEN, 'You are not the driver of this ride');
  return {
    myReview:        toReviewEntry(ride.driverReviewRating,    ride.driverReviewComment,    ride.driverReviewGivenAt),
    theirReview:     toReviewEntry(ride.passengerReviewRating, ride.passengerReviewComment, ride.passengerReviewGivenAt),
    isReviewed:      ride.isDriverReviewed,
    isTheirReviewed: ride.isPassengerReviewed,
  };
};

// ─────────────────────────────────────────────────────────────────────────────

export const RideService = {
  createRide,
  getMyRides,
  getRidesByStatus,
  submitRideReview,
  getRideReview,
  getMyActiveRide,
  driverAcceptRide,
  updateRideStatus,
  endRide,
  arrivedDropoff,
  confirmDropoff,
  payRide,
  collectCashPayment,
  estimateRideOptions,
  applyPromoToRide,
  cancelRide,
  adminGetAllRides,
  getNearestRides,
  getRecentRides,
};
