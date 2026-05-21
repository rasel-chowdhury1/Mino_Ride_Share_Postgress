import express from "express";
import { PaymentCardController } from "./paymentCard.controller";
import auth from "../../middleware/auth";
import { USER_ROLE } from "../user/user.constants";

const router = express.Router();

router
  .post(
    "/test-card",
    auth(USER_ROLE.DRIVER, USER_ROLE.PASSENGER),
    PaymentCardController.addTestCard
  )

  .post(
    "/add",
    auth(USER_ROLE.DRIVER, USER_ROLE.PASSENGER),
    PaymentCardController.addCard
  )

  .get(
    "/my",
    auth(USER_ROLE.DRIVER, USER_ROLE.PASSENGER),
    PaymentCardController.getMyCards
  )

  .patch(
    "/:id/set-default",
    auth(USER_ROLE.DRIVER, USER_ROLE.PASSENGER),
    PaymentCardController.setDefaultCard
  )

  .delete(
    "/:id",
    auth(USER_ROLE.DRIVER, USER_ROLE.PASSENGER),
    PaymentCardController.deleteCard
  );

export const PaymentCardRoutes = router;
