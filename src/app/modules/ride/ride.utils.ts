import prisma from '../../config/prisma';

// ─────────────────────────────────────────────────────────────────────────────

interface EstimateRideOptionsProps {
  distanceKm: number;
  country:    string;
  pickupLat:  number;
  pickupLng:  number;
}

type TVehicleType = 'MINO_GO' | 'MINO_COMFORT' | 'MINO_XL' | 'MINO_MOTO';

const AVERAGE_SPEED_KMH: Record<TVehicleType, number> = {
  MINO_GO:      40,
  MINO_COMFORT: 40,
  MINO_XL:      35,
  MINO_MOTO:    45,
};

const NEARBY_DRIVER_RADIUS_METERS = 5_000;
const FALLBACK_PICKUP_DISTANCE_KM = 2;

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Haversine formula — distance in km between two lat/lng points.
 */
export const getDistanceKm = (
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number => {
  const R    = 6_371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Finds available drivers near the pickup location using Haversine filtering
 * (replaces MongoDB $near).  Returns average pickup distance in km.
 */
const getAveragePickupDistanceKm = async (
  pickupLat:   number,
  pickupLng:   number,
  vehicleType: TVehicleType,
): Promise<{ avgDistanceKm: number; hasDrivers: boolean }> => {
  const radiusKm = NEARBY_DRIVER_RADIUS_RADIUS_KM();

  // Fetch candidates from a bounding box, then filter precisely with Haversine
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.cos((pickupLat * Math.PI) / 180));

  const candidates = await prisma.driverProfile.findMany({
    where: {
      vehicleType,
      isOnline:       true,
      isOnRide:       false,
      approvalStatus: 'verified',
      currentLat: {
        gte: pickupLat - latDelta,
        lte: pickupLat + latDelta,
      },
      currentLng: {
        gte: pickupLng - lngDelta,
        lte: pickupLng + lngDelta,
      },
    },
    select: { currentLat: true, currentLng: true },
    take:   20,
  });

  // Filter with exact Haversine distance
  const nearby = candidates.filter((d) => {
    if (d.currentLat == null || d.currentLng == null) return false;
    return getDistanceKm(pickupLat, pickupLng, d.currentLat, d.currentLng) * 1_000 <= NEARBY_DRIVER_RADIUS_METERS;
  });

  if (!nearby.length) {
    return { avgDistanceKm: FALLBACK_PICKUP_DISTANCE_KM, hasDrivers: false };
  }

  const total = nearby.reduce(
    (sum, d) => sum + getDistanceKm(pickupLat, pickupLng, d.currentLat!, d.currentLng!),
    0,
  );

  return { avgDistanceKm: total / nearby.length, hasDrivers: true };
};

function NEARBY_DRIVER_RADIUS_RADIUS_KM() {
  return NEARBY_DRIVER_RADIUS_METERS / 1_000;
}

// ─────────────────────────────────────────────────────────────────────────────

export const estimateRideOptions = async ({
  distanceKm,
  country,
  pickupLat,
  pickupLng,
}: EstimateRideOptionsProps) => {
  if (!distanceKm || isNaN(Number(distanceKm))) {
    throw new Error('Invalid distanceKm value');
  }
  if (!pickupLat || !pickupLng || isNaN(pickupLat) || isNaN(pickupLng)) {
    throw new Error('Invalid pickup location coordinates');
  }

  distanceKm = Number(distanceKm);

  const fare = await prisma.fare.findFirst({
    where: { country: country.toUpperCase() || "BANGLADESH", isActive: true },
  });

  if (!fare) throw new Error('Fare configuration not found for this country');

  const vehicleConfigs: { vehicleType: TVehicleType; baseFee: number; bookingFee: number; ratePerKm: number; minimumFare: number }[] = [
    { vehicleType: 'MINO_GO',      baseFee: fare.minoGoBaseFee,     bookingFee: fare.minoGoBookingFee,     ratePerKm: fare.minoGoRatePerKm,     minimumFare: fare.minoGoMinimumFare },
    { vehicleType: 'MINO_COMFORT', baseFee: fare.minoGoBaseFee,     bookingFee: fare.minoGoBookingFee,     ratePerKm: fare.minoGoRatePerKm,     minimumFare: fare.minoGoMinimumFare },
    { vehicleType: 'MINO_XL',      baseFee: fare.minoXLBaseFee,     bookingFee: fare.minoXLBookingFee,     ratePerKm: fare.minoXLRatePerKm,     minimumFare: fare.minoXLMinimumFare },
    { vehicleType: 'MINO_MOTO',    baseFee: fare.minoMotoBaseFee,   bookingFee: fare.minoMotoBookingFee,   ratePerKm: fare.minoMotoRatePerKm,   minimumFare: fare.minoMotoMinimumFare },
  ];

  const pickupResults = await Promise.all(
    vehicleConfigs.map(({ vehicleType }) =>
      getAveragePickupDistanceKm(pickupLat, pickupLng, vehicleType),
    ),
  );

  return vehicleConfigs.map(({ vehicleType, baseFee, bookingFee, ratePerKm, minimumFare }, i) => {
    const { avgDistanceKm, hasDrivers } = pickupResults[i];
    const speed = AVERAGE_SPEED_KMH[vehicleType];

    let estimatedFare = baseFee + bookingFee + ratePerKm * distanceKm;
    if (estimatedFare < minimumFare) estimatedFare = minimumFare;

    let totalFare = estimatedFare;
    if (fare.surchargeEnabled)     totalFare += fare.surchargeValue;
    if (fare.waitingChargeEnabled) totalFare += fare.waitingChargeRate * fare.waitingChargeGracePeriod;

    const adminCommission = (totalFare * fare.platformCommissionPercentage) / 100;
    const driverEarning   = totalFare - adminCommission;

    const estimatedArrivalTimeMin = Math.ceil((avgDistanceKm / speed) * 60);
    const estimatedRideTimeMin    = Math.ceil((distanceKm / speed) * 60);

    return {
      vehicleType,
      estimatedFare:          Math.round(estimatedFare),
      totalFare:              Math.round(totalFare),
      driverEarning:          Math.round(driverEarning),
      adminCommission:        Math.round(adminCommission),
      estimatedArrivalTimeMin,
      estimatedRideTimeMin,
      isAvailable:            hasDrivers,
    };
  });
};

// ─────────────────────────────────────────────────────────────────────────────

export const estimateMotoOptions = async ({
  distanceKm,
  country,
  pickupLat,
  pickupLng,
}: EstimateRideOptionsProps) => {
  if (!distanceKm || isNaN(Number(distanceKm))) {
    throw new Error('Invalid distanceKm value');
  }
  if (!pickupLat || !pickupLng || isNaN(pickupLat) || isNaN(pickupLng)) {
    throw new Error('Invalid pickup location coordinates');
  }

  distanceKm = Number(distanceKm);

  const fare = await prisma.fare.findFirst({
    where: { country: country.toUpperCase() || "BANGLADESH", isActive: true },
  });

  if (!fare) throw new Error('Fare configuration not found for this country');

  const { avgDistanceKm, hasDrivers } = await getAveragePickupDistanceKm(pickupLat, pickupLng, 'MINO_MOTO');
  const speed = AVERAGE_SPEED_KMH['MINO_MOTO'];

  let estimatedFare = fare.minoMotoBaseFee + fare.minoMotoBookingFee + fare.minoMotoRatePerKm * distanceKm;
  if (estimatedFare < fare.minoMotoMinimumFare) estimatedFare = fare.minoMotoMinimumFare;

  let totalFare = estimatedFare;
  if (fare.surchargeEnabled)     totalFare += fare.surchargeValue;
  if (fare.waitingChargeEnabled) totalFare += fare.waitingChargeRate * fare.waitingChargeGracePeriod;

  const adminCommission = (totalFare * fare.platformCommissionPercentage) / 100;
  const driverEarning   = totalFare - adminCommission;

  return {
    vehicleType:            'MINO_MOTO' as TVehicleType,
    estimatedFare:          Math.round(estimatedFare),
    totalFare:              Math.round(totalFare),
    driverEarning:          Math.round(driverEarning),
    adminCommission:        Math.round(adminCommission),
    estimatedArrivalTimeMin: Math.ceil((avgDistanceKm / speed) * 60),
    estimatedRideTimeMin:    Math.ceil((distanceKm / speed) * 60),
    isAvailable:            hasDrivers,
  };
};

// ─────────────────────────────────────────────────────────────────────────────

/**
 * Re-calculate fare fields using actual distance at ride end.
 * Returns the updated fare numbers (does not write to DB).
 */
export const recalculateFare = async (params: {
  country:         string;
  vehicleCategory: string;
  actualDistanceKm: number;
  promoDiscount:   number;
}): Promise<{
  estimatedFare:   number;
  totalFare:       number;
  adminCommission: number;
  driverEarning:   number;
}> => {


  const fare = await prisma.fare.findFirst({
    where: { country: params.country.toUpperCase() || "BANGLADESH", isActive: true },
  });
  if (!fare) throw new Error('Fare configuration not found for this country');

  const pricingMap: Record<string, { baseFee: number; bookingFee: number; ratePerKm: number; minimumFare: number }> = {
    MINO_GO:      { baseFee: fare.minoGoBaseFee,   bookingFee: fare.minoGoBookingFee,   ratePerKm: fare.minoGoRatePerKm,   minimumFare: fare.minoGoMinimumFare },
    MINO_COMFORT: { baseFee: fare.minoGoBaseFee,   bookingFee: fare.minoGoBookingFee,   ratePerKm: fare.minoGoRatePerKm,   minimumFare: fare.minoGoMinimumFare },
    MINO_XL:      { baseFee: fare.minoXLBaseFee,   bookingFee: fare.minoXLBookingFee,   ratePerKm: fare.minoXLRatePerKm,   minimumFare: fare.minoXLMinimumFare },
    MINO_MOTO:    { baseFee: fare.minoMotoBaseFee, bookingFee: fare.minoMotoBookingFee, ratePerKm: fare.minoMotoRatePerKm, minimumFare: fare.minoMotoMinimumFare },
  };
  
  const pricing = pricingMap[params.vehicleCategory] ?? pricingMap['MINO_GO'];

  let estimatedFare = pricing.baseFee + pricing.bookingFee + pricing.ratePerKm * params.actualDistanceKm;
  if (estimatedFare < pricing.minimumFare) estimatedFare = pricing.minimumFare;

  let totalFare = estimatedFare;
  if (fare.surchargeEnabled)     totalFare += fare.surchargeValue;
  if (fare.waitingChargeEnabled) totalFare += fare.waitingChargeRate * fare.waitingChargeGracePeriod;

  totalFare = Math.max(0, totalFare - params.promoDiscount);

  const adminCommission = (totalFare * fare.platformCommissionPercentage) / 100;
  const driverEarning   = totalFare - adminCommission;

  return {
    estimatedFare:   Math.round(estimatedFare),
    totalFare:       Math.round(totalFare),
    adminCommission: Math.round(adminCommission),
    driverEarning:   Math.round(driverEarning),
  };

};
