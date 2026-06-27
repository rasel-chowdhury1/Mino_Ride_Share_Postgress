import { Router } from 'express';
import auth from '../../middleware/auth';
import { notificationController } from './notifications.controller';
import { otpControllers } from '../otp/otp.controller';
import { USER_ROLE } from '../user/user.constants';

export const notificationRoutes = Router();



notificationRoutes
  .post(
    "/create",
    auth('user', "admin"),
    notificationController.createNotification
  )
  
  .get(
    '/all-notifications', 
    auth(USER_ROLE.ADMIN, USER_ROLE.SUPERADMIN), 
    notificationController.getAllNotifications
  )

  .get(
    '/my-notifications', 
    auth(USER_ROLE.PASSENGER, USER_ROLE.DRIVER, USER_ROLE.ADMIN, USER_ROLE.SUPERADMIN), 
    notificationController.getMyNotifications
  )

  .patch(
    '/mark-read/:id', 
    auth(USER_ROLE.PASSENGER, USER_ROLE.DRIVER, USER_ROLE.ADMIN, USER_ROLE.SUPERADMIN), 
    notificationController.markAsRead
  )

  .patch(
    "/read-all", 
    auth(USER_ROLE.PASSENGER, USER_ROLE.DRIVER, USER_ROLE.ADMIN, USER_ROLE.SUPERADMIN), 
    notificationController.markAllAsRead
  )

  
  .delete(
    '/delete/:id', 
    auth(USER_ROLE.PASSENGER, USER_ROLE.DRIVER, USER_ROLE.ADMIN, USER_ROLE.SUPERADMIN), 
    notificationController.deleteNotification
  );
