import { Request, Response } from "express";
import httpStatus from "http-status";
import catchAsync from "../../utils/catchAsync";
import sendResponse from "../../utils/sendResponse";
import { PaymentCardService, addTestCardService } from "./paymentCard.service";

const addCard = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.userId;
  const { paymentMethodId, isDefault } = req.body;
  const result = await PaymentCardService.addCard(userId, { paymentMethodId, isDefault });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Card added successfully",
    data: result,
  });
});

const getMyCards = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.userId;
  const result = await PaymentCardService.getMyCards(userId);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Cards retrieved successfully",
    data: result,
  });
});

const setDefaultCard = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.userId;
  const { id } = req.params;
  const result = await PaymentCardService.setDefaultCard(userId, id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Default card updated successfully",
    data: result,
  });
});

const deleteCard = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.userId;
  const { id } = req.params;


  await PaymentCardService.deleteCard(userId, id);

  sendResponse(res, {
    statusCode: httpStatus.OK,
    success: true,
    message: "Card removed successfully",
    data: null,
  });
});

const addTestCard = catchAsync(async (req: Request, res: Response) => {
  const userId = req.user.userId;
  const { isDefault } = req.body;
  const result = await addTestCardService(userId, { isDefault });

  sendResponse(res, {
    statusCode: httpStatus.CREATED,
    success: true,
    message: "Test card added successfully",
    data: result,
  });
});

export const PaymentCardController = {
  addCard,
  getMyCards,
  setDefaultCard,
  deleteCard,
  addTestCard,
};
