import httpStatus from 'http-status';
import Stripe from 'stripe';
import { CardBrand, WalletProvider } from '@prisma/client';
import { stripe } from '../../config/stripe';
import prisma from '../../config/prisma';
import AppError from '../../error/AppError';
import { logger } from '../../utils/logger';
import { cardPublicSelect, ISaveCardResult } from './paymentCard.interface';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapStripeBrand(brand?: string | null): CardBrand {
  const map: Record<string, CardBrand> = {
    visa:       CardBrand.visa,
    mastercard: CardBrand.mastercard,
    amex:       CardBrand.amex,
    discover:   CardBrand.discover,
    diners:     CardBrand.diners,
    jcb:        CardBrand.jcb,
    unionpay:   CardBrand.unionpay,
  };
  return map[brand ?? ''] ?? CardBrand.unknown;
}

function mapWalletProvider(walletType?: string | null): WalletProvider | null {
  const map: Record<string, WalletProvider> = {
    apple_pay:  WalletProvider.apple_pay,
    google_pay: WalletProvider.google_pay,
    paypal:     WalletProvider.paypal,
  };
  return map[walletType ?? ''] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ensureStripeCustomer — create Stripe customer once, persist to DB
// ─────────────────────────────────────────────────────────────────────────────

const ensureStripeCustomer = async (userId: string): Promise<string> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, stripeCustomerId: true },
  });

  if (!user) throw new AppError(httpStatus.NOT_FOUND, 'User not found');

  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    name:  user.name ?? undefined,
    metadata: { userId },
  });

  await prisma.user.update({
    where: { id: userId },
    data:  { stripeCustomerId: customer.id },
  });

  return customer.id;
};

// ─────────────────────────────────────────────────────────────────────────────
// createSetupIntent — client uses clientSecret to collect card via Stripe.js
// ─────────────────────────────────────────────────────────────────────────────

const createSetupIntent = async (userId: string) => {
  const customerId = await ensureStripeCustomer(userId);

  const intent = await stripe.setupIntents.create({
    customer:  customerId,
    usage:     'off_session',
    metadata:  { userId },
    automatic_payment_methods: { enabled: true },
  });

  return {
    clientSecret:  intent.client_secret!,
    customerId,
    setupIntentId: intent.id,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// savePaymentCard — attach pm to customer, persist to DB
// ─────────────────────────────────────────────────────────────────────────────

const savePaymentCard = async (
  userId:          string,
  paymentMethodId: string,
): Promise<ISaveCardResult> => {

  console.log("save payment card params =>>>>> ", {userId, paymentMethodId})
  const customerId = await ensureStripeCustomer(userId);

  // Retrieve PaymentMethod from Stripe
  let pm: Stripe.PaymentMethod;
  try {
    pm = await stripe.paymentMethods.retrieve(paymentMethodId);
  } catch (err: any) {
    throw new AppError(httpStatus.BAD_REQUEST, `Invalid paymentMethodId: ${err.message}`);
  }

  console.log("pm data =>>>> ", pm)

  if (pm.type !== 'card') {
    throw new AppError(httpStatus.BAD_REQUEST, 'Only card payment methods are supported');
  }

  // কার্ড attach করো — already-attached এ error হয় না, skip করো
  if (pm.customer !== customerId) {
    try {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    } catch (err: any) {
      if (err?.code === 'payment_method_already_attached') {
        // acceptable — do nothing
      } else {
        throw new AppError(httpStatus.BAD_REQUEST, err.message ?? 'Failed to attach card');
      }
    }
  }

  const card        = pm.card!;
  const fingerprint = card.fingerprint ?? null;

  // Fingerprint duplicate check — same physical card already on this account?
  if (fingerprint) {
    const dupByFingerprint = await prisma.paymentCard.findFirst({
      where: { userId, fingerprint, isDeleted: false },
    });
    if (dupByFingerprint) {
      throw new AppError(httpStatus.CONFLICT, 'This card is already saved on your account');
    }
  }

  // Existing record by stripePaymentMethodId?
  const existing = await prisma.paymentCard.findFirst({
    where: { stripePaymentMethodId: paymentMethodId },
  });

  if (existing) {
    if (!existing.isDeleted) {
      throw new AppError(httpStatus.CONFLICT, 'This card is already saved on your account');
    }
    // Reactivate soft-deleted record
    const reactivated = await prisma.paymentCard.update({
      where: { id: existing.id },
      data:  { isDeleted: false, updatedAt: new Date() },
      select: cardPublicSelect,
    });
    return reactivated as ISaveCardResult;
  }

  // First card for this user → make it the default
  const cardCount = await prisma.paymentCard.count({
    where: { userId, isDeleted: false },
  });
  const isDefault = cardCount === 0;

  const walletType     = (card.wallet as any)?.type ?? null;
  const walletProvider = mapWalletProvider(walletType);

  const saved = await prisma.paymentCard.create({
    data: {
      userId,
      stripeCustomerId:      customerId,
      stripePaymentMethodId: paymentMethodId,
      type:                  walletProvider ? 'WALLET' : 'CARD',
      brand:                 mapStripeBrand(card.brand),
      walletProvider:        walletProvider ?? undefined,
      last4:                 card.last4,
      expMonth:              card.exp_month  ?? null,
      expYear:               card.exp_year   ?? null,
      cardHolderName:        pm.billing_details?.name ?? null,
      funding:               card.funding    ?? null,
      country:               card.country    ?? null,
      fingerprint,
      isDefault,
    },
    select: cardPublicSelect,
  });

  return saved as ISaveCardResult;
};

// ─────────────────────────────────────────────────────────────────────────────
// listUserCards — public-safe fields only, no Stripe IDs
// ─────────────────────────────────────────────────────────────────────────────

const listUserCards = async (userId: string): Promise<ISaveCardResult[]> => {
  const cards = await prisma.paymentCard.findMany({
    where:   { userId, isDeleted: false },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    select:  cardPublicSelect,
  });
  return cards as ISaveCardResult[];
};

// ─────────────────────────────────────────────────────────────────────────────
// setDefaultCard
// ─────────────────────────────────────────────────────────────────────────────

const setDefaultCard = async (userId: string, cardId: string): Promise<ISaveCardResult> => {
  const card = await prisma.paymentCard.findFirst({
    where: { id: cardId, userId, isDeleted: false },
  });

  if (!card) throw new AppError(httpStatus.NOT_FOUND, 'Card not found');

  await prisma.$transaction([
    prisma.paymentCard.updateMany({
      where: { userId, isDeleted: false },
      data:  { isDefault: false },
    }),
    prisma.paymentCard.update({
      where: { id: cardId },
      data:  { isDefault: true },
    }),
  ]);

  const updated = await prisma.paymentCard.findUnique({
    where:  { id: cardId },
    select: cardPublicSelect,
  });

  return updated as ISaveCardResult;
};

// ─────────────────────────────────────────────────────────────────────────────
// deleteCard — detach from Stripe, soft-delete, auto-promote new default
// ─────────────────────────────────────────────────────────────────────────────

const deleteCard = async (userId: string, cardId: string): Promise<void> => {
  const card = await prisma.paymentCard.findFirst({
    where: { id: cardId, userId, isDeleted: false },
  });

  if (!card) throw new AppError(httpStatus.NOT_FOUND, 'Card not found');

  // Detach from Stripe — ignore resource_missing (already detached / deleted)
  try {
    await stripe.paymentMethods.detach(card.stripePaymentMethodId);
  } catch (err: any) {
    if (err?.code !== 'resource_missing') {
      logger.warn(`deleteCard: Stripe detach failed for ${card.stripePaymentMethodId}:`, err);
    }
  }

  await prisma.paymentCard.update({
    where: { id: cardId },
    data:  { isDeleted: true, isDefault: false },
  });

  // Auto-promote most recent remaining card to default
  if (card.isDefault) {
    const next = await prisma.paymentCard.findFirst({
      where:   { userId, isDeleted: false },
      orderBy: { createdAt: 'desc' },
    });
    if (next) {
      await prisma.paymentCard.update({
        where: { id: next.id },
        data:  { isDefault: true },
      });
    }
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// getDefaultCard — internal use by ride module; includes Stripe IDs
// ─────────────────────────────────────────────────────────────────────────────

const getDefaultCard = async (userId: string) => {
  const card = await prisma.paymentCard.findFirst({
    where: { userId, isDefault: true, isDeleted: false },
  });

  if (!card) {
    throw new AppError(httpStatus.NOT_FOUND, 'No default payment card found. Please add a card first.');
  }

  return card;
};

// ─────────────────────────────────────────────────────────────────────────────
// markCardUsed — fire-and-forget from ride module after charge
// ─────────────────────────────────────────────────────────────────────────────

const markCardUsed = async (cardId: string): Promise<void> => {
  await prisma.paymentCard.update({
    where: { id: cardId },
    data:  { lastUsedAt: new Date() },
  });
};

// ─────────────────────────────────────────────────────────────────────────────
// addTestCard — DEV/TEST only. Creates a pm_ directly on Stripe server-side
// so Postman doesn't need a two-step flow.
// ─────────────────────────────────────────────────────────────────────────────

const TEST_CARDS: Record<string, { token: string; label: string }> = {
  visa:             { token: 'tok_visa',                  label: 'Visa (success)'         },
  visa_debit:       { token: 'tok_visa_debit',            label: 'Visa Debit'             },
  mastercard:       { token: 'tok_mastercard',            label: 'Mastercard'             },
  mastercard_debit: { token: 'tok_mastercard_debit',      label: 'Mastercard Debit'       },
  amex:             { token: 'tok_amex',                  label: 'Amex'                   },
  declined:         { token: 'tok_chargeDeclined',        label: 'Visa (always declined)' },
  insufficient:     { token: 'tok_chargeDeclinedInsufficientFunds', label: 'Insufficient funds' },
};

const addTestCard = async (
  userId:   string,
  cardType: string = 'visa',
): Promise<ISaveCardResult> => {
  if (process.env.NODE_ENV === 'production') {
    throw new AppError(httpStatus.FORBIDDEN, 'Test card endpoint is disabled in production');
  }

  const testCard = TEST_CARDS[cardType];
  if (!testCard) {
    throw new AppError(
      httpStatus.BAD_REQUEST,
      `Unknown cardType. Available: ${Object.keys(TEST_CARDS).join(', ')}`,
    );
  }

  try {
    const pm = await stripe.paymentMethods.create({
      type: 'card',
      card: { token: testCard.token }, // ✅ Use token instead of raw card data
      billing_details: { name: 'Test User' },
    });

    return savePaymentCard(userId, pm.id);
  } catch (error) {
    console.error('pm error =>>>>>', error);
    throw new AppError(httpStatus.INTERNAL_SERVER_ERROR, 'Failed to create test payment method');
  }
};

// ─────────────────────────────────────────────────────────────────────────────

export const PaymentCardService = {
  ensureStripeCustomer,
  createSetupIntent,
  savePaymentCard,
  listUserCards,
  setDefaultCard,
  deleteCard,
  getDefaultCard,
  markCardUsed,
  addTestCard,
};
