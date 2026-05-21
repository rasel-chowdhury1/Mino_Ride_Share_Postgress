import { Types } from "mongoose";

export enum CardType {
  VISA       = "visa",
  MASTER     = "master",
  APPLE_PAY  = "apple",
  PAYPAL     = "paypal",
}

export interface IPaymentCard {
  userId: Types.ObjectId;
  cardType: CardType;
  cardHolderName: string;
  maskedCardNumber: string;   // "* * * * 4242" — safe to display
  encryptedCardNumber: string; // AES-256 encrypted
  expiry: string;              // "09/26"
  encryptedCvv: string;        // AES-256 encrypted
  encryptedSecurityCode: string; // AES-256 encrypted
  isDefault: boolean;
  isDeleted: boolean;
}
