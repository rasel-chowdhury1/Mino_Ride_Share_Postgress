import httpStatus from "http-status";
import Stripe from "stripe";
import config from "../../config";
import { PaymentCard } from "./paymentCard.model";
import { User } from "../user/user.model";
import AppError from "../../error/AppError";
import mongoose from "mongoose";

const stripe = new Stripe(config.stripe.stripe_api_secret as string);



export const addTestCardService = async (
  userId: string,
  payload?: {
    isDefault?: boolean;
  }
) => {

  // 1️⃣ user check
  const user = await User.findById(userId);

  if (!user) {
    throw new AppError(httpStatus.NOT_FOUND, "User not found");
  }

  let customerId = user.stripeCustomerId;

  // 2️⃣ create stripe customer if not exists
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email,
    });

    customerId = customer.id;
    user.stripeCustomerId = customerId;
    await user.save();
  }


  
        // 3️⃣ create test payment method (⚠️ only test mode)
   const paymentMethod = await stripe.paymentMethods.create({
    type: "card",
    card: {
        token: "tok_visa",
      },
  });


  // 4️⃣ attach to customer
  await stripe.paymentMethods.attach(paymentMethod.id, {
    customer: customerId,
  });

  // 5️⃣ get card details
  const pm: any = await stripe.paymentMethods.retrieve(paymentMethod.id);




  // 6️⃣ handle default card
  if (payload?.isDefault) {
    await PaymentCard.updateMany({ userId }, { isDefault: false });

    await stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethod.id,
      },
    });
  }

  // 7️⃣ save in DB (safe data only)
  const card = await PaymentCard.create({
    userId,
    stripeCustomerId: customerId,
    stripePaymentMethodId: paymentMethod.id,
    brand: pm.card.brand,
    last4: pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear: pm.card.exp_year,
    isDefault: payload?.isDefault ?? false,
  });

  return card;
};

// ─── Helper: get or create Stripe customer ────────────────────────────────────

const getOrCreateStripeCustomer = async (userId: string): Promise<string> => {
  const user = await User.findById(userId).select("stripeCustomerId email name");
  if (!user) throw new AppError(httpStatus.NOT_FOUND, "User not found");

  if (user.stripeCustomerId) return user.stripeCustomerId;

  const customer = await stripe.customers.create({
    email: user.email,
    name: user.name,
    metadata: { userId },
  });

  await User.findByIdAndUpdate(userId, { stripeCustomerId: customer.id });

  return customer.id;
};

// ─── Add card ─────────────────────────────────────────────────────────────────

const addCard = async (
  userId: string,
  payload: { paymentMethodId: string; isDefault?: boolean }
) => {
  const customerId = await getOrCreateStripeCustomer(userId);

  // attach payment method to customer
  await stripe.paymentMethods.attach(payload.paymentMethodId, {
    customer: customerId,
  });

  // fetch card metadata from Stripe
  const pm = await stripe.paymentMethods.retrieve(payload.paymentMethodId);

  if (!pm.card) {
    throw new AppError(httpStatus.BAD_REQUEST, "Invalid payment method — card details not found");
  }

  // if default — unset all others + update Stripe customer default
  if (payload.isDefault) {
    await PaymentCard.updateMany({ userId }, { isDefault: false });

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: payload.paymentMethodId },
    });
  }

  const card = await PaymentCard.create({
    userId,
    stripeCustomerId:      customerId,
    stripePaymentMethodId: payload.paymentMethodId,
    brand:    pm.card.brand,
    last4:    pm.card.last4,
    expMonth: pm.card.exp_month,
    expYear:  pm.card.exp_year,
    isDefault: payload.isDefault ?? false,
  });

  return card;
};

// ─── Get user cards ───────────────────────────────────────────────────────────

const getMyCards = async (userId: string) => {
  return PaymentCard.find({ userId, isDeleted: false }).sort("-isDefault -createdAt");
};

// ─── Set default card ─────────────────────────────────────────────────────────

const setDefaultCard = async (userId: string, cardId: string) => {
  const card = await PaymentCard.findOne({ _id: cardId, userId });
  if (!card) throw new AppError(httpStatus.NOT_FOUND, "Card not found");

  await PaymentCard.updateMany({ userId }, { isDefault: false });

  await stripe.customers.update(card.stripeCustomerId, {
    invoice_settings: { default_payment_method: card.stripePaymentMethodId },
  });

  await PaymentCard.findByIdAndUpdate(cardId, { isDefault: true });

  return null;
};

// ─── Delete card ──────────────────────────────────────────────────────────────

const deleteCard = async (userId: string, cardId: string) => {
  const objectCardId = new mongoose.Types.ObjectId(cardId);

  const card = await PaymentCard.findOne({
    _id: objectCardId,
    userId,
    isDeleted: false,
  });

  if (!card) {
    throw new AppError(httpStatus.NOT_FOUND, "Card not found");
  }

  // 🔐 Detach from Stripe (safe handling)
  if (card.stripePaymentMethodId) {
    try {
      await stripe.paymentMethods.detach(card.stripePaymentMethodId);
    } catch (error) {
      // optional: log error but don’t break flow
      console.error("Stripe detach failed:", error);
    }
  }

  // ✅ Ensure user ownership while updating
  await PaymentCard.findByIdAndUpdate(cardId, { isDeleted: true });

  return null;
};

export const PaymentCardService = {
  getOrCreateStripeCustomer,
  addCard,
  getMyCards,
  setDefaultCard,
  deleteCard,
};
