import { OtpPurpose, OtpReceiverType, OtpStatus } from '@prisma/client';
import httpStatus from 'http-status';

import prisma from '../../config/prisma';
import AppError from '../../error/AppError';
import config from '../../config';
import { verifyToken } from '../../utils/tokenManage';
import { generateOptAndExpireTime } from './otp.utils';
import { otpSendEmail } from '../../utils/emailNotification';
import type { CreateOtpParams } from './otp.interface';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Map the string-based purpose used across the codebase to Prisma enum. */
function mapPurpose(purpose: string): OtpPurpose {
  const map: Record<string, OtpPurpose> = {
    'email-verification': OtpPurpose.email_verification,
    'reset-password':     OtpPurpose.reset_password,
    'forget-password':    OtpPurpose.forget_password,
  };
  return map[purpose] ?? OtpPurpose.email_verification;
}

function mapReceiverType(type: string): OtpReceiverType {
  return type === 'phone' ? OtpReceiverType.phone : OtpReceiverType.email;
}

// ── Service functions ─────────────────────────────────────────────────────────

const createOtp = async ({
  sentTo,
  receiverType,
  purpose,
  otp,
  expiredAt,
}: CreateOtpParams) => {
  return prisma.otp.create({
    data: {
      sentTo,
      receiverType: mapReceiverType(receiverType),
      purpose:      mapPurpose(purpose),
      otp,
      expiredAt:    new Date(expiredAt),
      status:       OtpStatus.pending,
    },
  });
};

const checkOtpByEmail = async (email: string, purpose: string) => {
  const mappedPurpose = mapPurpose(purpose);

  const isExist = await prisma.otp.findFirst({
    where: { sentTo: email, purpose: mappedPurpose },
  });

  const isExpireOtp = isExist
    ? new Date(isExist.expiredAt) < new Date()
    : false;

  return { isExist, isExpireOtp };
};

const checkOtpByNumber = async (phone: string) => {
  const isExist = await prisma.otp.findFirst({
    where: { sentTo: phone },
  });

  const isExpireOtp = isExist
    ? new Date(isExist.expiredAt) < new Date()
    : false;

  return { isExist, isExpireOtp };
};

const otpMatch = async (email: string, purpose: string, otp: string) => {
  return prisma.otp.findFirst({
    where: {
      sentTo:    email,
      purpose:   mapPurpose(purpose),
      otp,
      status:    OtpStatus.pending,
      expiredAt: { gt: new Date() },
    },
  });
};

const updateOtpByEmail = async (
  email: string,
  purpose: string,
  payload: { otp?: string; expiredAt?: any; status?: string },
) => {
  const mappedPurpose = mapPurpose(purpose);

  const updateData: Record<string, unknown> = {};
  if (payload.otp)       updateData.otp       = payload.otp;
  if (payload.expiredAt) updateData.expiredAt  = new Date(payload.expiredAt);
  if (payload.status)    updateData.status     = payload.status as OtpStatus;

  return prisma.otp.updateMany({
    where: { sentTo: email, purpose: mappedPurpose },
    data:  updateData,
  });
};

const deleteOtpsByEmail = async (email: string) => {
  return prisma.otp.deleteMany({ where: { sentTo: email } });
};

const resendOtpEmail = async ({ token, purpose }: { token: string; purpose: string }) => {
  if (!token) throw new AppError(httpStatus.BAD_REQUEST, 'Token not found');

  const decodeData = verifyToken({ token, access_secret: config.jwt_access_secret as string });
  const { email } = decodeData;

  const { isExist, isExpireOtp } = await checkOtpByEmail(email, purpose);

  if (!isExist) throw new AppError(httpStatus.BAD_REQUEST, 'Token data is not valid!');
  if (isExist && !isExpireOtp) throw new AppError(httpStatus.BAD_REQUEST, 'OTP exists. Please check your email.');

  const { otp, expiredAt } = generateOptAndExpireTime();

  await updateOtpByEmail(email, purpose, { otp, expiredAt: new Date(expiredAt) });

  process.nextTick(async () => {
    await otpSendEmail({ sentTo: email, subject: 'Re-send OTP for email verification', name: '', otp, expiredAt });
  });
};

export const otpServices = {
  createOtp,
  deleteOtpsByEmail,
  checkOtpByEmail,
  checkOtpByNumber,
  otpMatch,
  updateOtpByEmail,
  resendOtpEmail,
};
