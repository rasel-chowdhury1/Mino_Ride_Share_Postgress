import Stripe from 'stripe';
import config from './index';

if (!config.stripe.stripe_api_secret) {
  throw new Error('STRIPE_API_SECRET is not defined in environment variables');
}

export const stripe = new Stripe(config.stripe.stripe_api_secret as string);

export const STRIPE_WEBHOOK_SECRET: string =
  (config.stripe.stripe_webhook_secret as string) || '';
