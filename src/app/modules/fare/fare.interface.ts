
export interface IFare {
  country: string;

  minoGoRatePerKm:   number;
  minoGoBookingFee:  number;
  minoGoBaseFee:     number;
  minoGoMinimumFare: number;

  minoXLRatePerKm:   number;
  minoXLBookingFee:  number;
  minoXLBaseFee:     number;
  minoXLMinimumFare: number;

  minoMotoRatePerKm:   number;
  minoMotoBookingFee:  number;
  minoMotoBaseFee:     number;
  minoMotoMinimumFare: number;

  waitingChargeEnabled:     boolean;
  waitingChargeGracePeriod: number;
  waitingChargeRate:        number;

  surchargeEnabled: boolean;
  surchargeValue:   number;

  platformCommissionPercentage: number;
  isActive:  boolean;
  isDeleted: boolean;
}
