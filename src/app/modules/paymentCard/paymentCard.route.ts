import { Router } from 'express';
import auth from '../../middleware/auth';
import validateRequest from '../../middleware/validateRequest';
import { USER_ROLE } from '../user/user.constants';
import { PaymentCardController } from './paymentCard.controller';
import { savePaymentCardSchema } from './paymentCard.validation';

const router = Router();

router
  /** Create a Stripe SetupIntent — client uses clientSecret to collect card */
  .post(
    '/setup-intent',
    auth(USER_ROLE.PASSENGER),
    PaymentCardController.createSetupIntent,
  )

  /** Save card after Stripe.js confirms the SetupIntent */
  .post(
    '/save',
    auth(USER_ROLE.PASSENGER),
    validateRequest(savePaymentCardSchema),
    PaymentCardController.savePaymentCard,
  )

  /** List all saved cards for the authenticated passenger */
  .get(
    '/my-cards',
    auth(USER_ROLE.PASSENGER),
    PaymentCardController.listMyCards,
  )

  /** Set a card as the default payment method */
  .patch(
    '/:cardId/default',
    auth(USER_ROLE.PASSENGER),
    PaymentCardController.setDefault,
  )

  /** Remove a card (soft-delete + Stripe detach) */
  .delete(
    '/:cardId',
    auth(USER_ROLE.PASSENGER),
    PaymentCardController.deleteCard,
  )

  /** DEV/TEST only — add a Stripe test card without needing Stripe.js */
  .post(
    '/test/add-card',
    auth(USER_ROLE.PASSENGER),
    PaymentCardController.addTestCard,
  );

export const PaymentCardRoutes = router;
