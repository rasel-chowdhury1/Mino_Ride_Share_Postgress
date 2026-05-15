
export type TPaymentMethod = 'CASH' | 'WALLET' | 'CARD';
export type TPaymentStatus = 'PENDING' | 'PAID' | 'FAILED' | 'REFUNDED';

export interface IPayment {
  transactionId?:         string;
  rideId:                 string;
  passengerId:            string;
  driverId:               string;
  amount:                 number;
  totalFare:              number;
  driverEarning:          number;
  adminCommission:        number;
  promo?:                 string | null;
  promoDiscount:          number;
  tip:                    number;
  paymentMethod:          TPaymentMethod;
  paymentStatus:          TPaymentStatus;
  stripePaymentIntentId?: string;
  paidAt?:                Date;
  isDeleted:              boolean;
}
