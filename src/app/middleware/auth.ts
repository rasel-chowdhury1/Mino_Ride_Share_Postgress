import httpStatus from 'http-status';

import prisma from '../config/prisma';
import AppError from '../error/AppError';
import catchAsync from '../utils/catchAsync';
import { verifyToken } from '../utils/tokenManage';
import config from '../config';

const auth = (...userRoles: string[]) => {
  return catchAsync(async (req, _res, next) => {
    const token: string | undefined =
      (req.headers?.authorization as string) ||
      (req.headers?.token as string);

    if (!token) {
      throw new AppError(httpStatus.UNAUTHORIZED, 'You are not authorized!');
    }

    const decodeData = verifyToken({
      token,
      access_secret: config.jwt_access_secret as string,
    });

    const { role, userId } = decodeData;

    const isUserExist = await prisma.user.findUnique({
      where: { id: userId, isDeleted: false },
    });

    if (!isUserExist) {
      throw new AppError(httpStatus.NOT_FOUND, 'User not found');
    }

    if (userRoles.length && !userRoles.includes(role)) {
      throw new AppError(httpStatus.UNAUTHORIZED, 'You are not authorized');
    }

    req.user = decodeData;
    next();
  });
};

export default auth;
