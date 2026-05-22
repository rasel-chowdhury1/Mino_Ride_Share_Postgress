import { CardBrand, PaymentCardType, WalletProvider } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────

export interface ISetupIntentResult {
  clientSecret: string;
  customerId: string;
  setupIntentId: string;
}

export interface ISaveCardResult {
  id: string;
  userId: string;
  type: PaymentCardType;
  brand: CardBrand;
  walletProvider: WalletProvider | null;
  last4: string;
  expMonth: number | null;
  expYear: number | null;
  cardHolderName: string | null;
  funding: string | null;
  country: string | null;
  isDefault: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ICardListItem extends ISaveCardResult {}

// Card select clause — strips Stripe IDs before sending to client
export const cardPublicSelect = {
  id: true,
  userId: true,
  type: true,
  brand: true,
  walletProvider: true,
  last4: true,
  expMonth: true,
  expYear: true,
  cardHolderName: true,
  funding: true,
  country: true,
  isDefault: true,
  lastUsedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;
