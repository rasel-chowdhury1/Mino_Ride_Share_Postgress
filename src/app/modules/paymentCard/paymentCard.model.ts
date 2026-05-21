
import { Schema, model } from "mongoose";

const paymentCardSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    stripeCustomerId: {
      type: String,
      required: true,
    },
    stripePaymentMethodId: {
      type: String,
      required: true,
    },
    brand: String,
    last4: String,
    expMonth: Number,
    expYear: Number,

    isDefault: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

export const PaymentCard = model("PaymentCard", paymentCardSchema);