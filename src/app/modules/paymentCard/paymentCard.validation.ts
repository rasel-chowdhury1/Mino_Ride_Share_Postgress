import { z } from 'zod';

// validateRequest middleware wraps in { body, files, file, cookies }
export const savePaymentCardSchema = z.object({
  body: z.object({
    paymentMethodId: z
      .string({ required_error: 'paymentMethodId is required' })
      .startsWith('pm_', { message: 'Invalid Stripe paymentMethodId — must start with pm_' }),
  }),
});
