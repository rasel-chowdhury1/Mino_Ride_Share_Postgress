import { Request, Response } from 'express';
import httpStatus from 'http-status';
import catchAsync from '../../utils/catchAsync';
import sendResponse from '../../utils/sendResponse';
import { PaymentCardService } from './paymentCard.service';

// ─────────────────────────────────────────────────────────────────────────────

const createSetupIntent = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user;
  const result = await PaymentCardService.createSetupIntent(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success:    true,
    message:    'Setup intent created. Use clientSecret with Stripe.js to collect card details.',
    data:       result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const savePaymentCard = catchAsync(async (req: Request, res: Response) => {
  const { userId }          = req.user;
  const { paymentMethodId } = req.body as { paymentMethodId: string };

  const result = await PaymentCardService.savePaymentCard(userId, paymentMethodId);

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success:    true,
    message:    'Card saved successfully',
    data:       result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const listMyCards = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user;
  const result = await PaymentCardService.listUserCards(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success:    true,
    message:    'Cards retrieved successfully',
    data:       result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const setDefault = catchAsync(async (req: Request, res: Response) => {
  const { userId }  = req.user;
  const { cardId }  = req.params;

  const result = await PaymentCardService.setDefaultCard(userId, cardId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success:    true,
    message:    'Default card updated successfully',
    data:       result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────

const deleteCard = catchAsync(async (req: Request, res: Response) => {
  const { userId } = req.user;
  const { cardId } = req.params;

  await PaymentCardService.deleteCard(userId, cardId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success:    true,
    message:    'Card removed successfully',
    data:       null,
  });
});

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────

const addTestCard = catchAsync(async (req: Request, res: Response) => {
  const { userId }   = req.user;
  const { cardType } = req.body as { cardType?: string };

  const result = await PaymentCardService.addTestCard(userId, cardType ?? 'visa');

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success:    true,
    message:    'Test card added successfully',
    data:       result,
  });
});

// ─────────────────────────────────────────────────────────────────────────────

export const PaymentCardController = {
  createSetupIntent,
  savePaymentCard,
  listMyCards,
  setDefault,
  deleteCard,
  addTestCard,
};
