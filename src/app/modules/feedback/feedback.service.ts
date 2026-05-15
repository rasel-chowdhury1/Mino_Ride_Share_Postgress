
import { FeedbackStatus } from '@prisma/client';
import AppError from '../../error/AppError';
import httpStatus from 'http-status';
import prisma from '../../config/prisma';
import { IFeedback, IUpdateFeedback } from './feedback.interface';

const userSelect = { name: true, role: true, profileImage: true } as const;

const buildPagination = (query: Record<string, unknown>) => {
  const page  = Math.max(1, Number(query.page)  || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

const createFeedback = async (payload: IFeedback) => {
  return prisma.feedback.create({
    data: {
      userId: payload.userId,
      rating: payload.rating,
      text:   payload.text,
    },
  });
};

const getAllFeedbacks = async (query: Record<string, unknown> = {}) => {
  const { skip, take, page, limit } = buildPagination(query);
  const searchTerm = query.searchTerm as string | undefined;

  const where = {
    isDeleted:     false,
    adminVerified: FeedbackStatus.verified,
    ...(searchTerm && { text: { contains: searchTerm, mode: 'insensitive' as const } }),
  };

  const [result, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { user: { select: userSelect } },
    }),
    prisma.feedback.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

const getAllFeedbacksByAdmin = async (query: Record<string, unknown> = {}) => {
  const { skip, take, page, limit } = buildPagination(query);
  const searchTerm = query.searchTerm as string | undefined;

  const where = {
    isDeleted: false,
    ...(searchTerm && { text: { contains: searchTerm, mode: 'insensitive' as const } }),
  };

  const [result, total] = await Promise.all([
    prisma.feedback.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { user: { select: userSelect } },
    }),
    prisma.feedback.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

const getFeedbackById = async (id: string) => {
  return prisma.feedback.findFirst({
    where:   { id, isDeleted: false },
    include: { user: { select: userSelect } },
  });
};

const updateFeedback = async (id: string, userId: string, payload: IUpdateFeedback) => {
  const existing = await prisma.feedback.findFirst({ where: { id, userId, isDeleted: false } });
  if (!existing) return null;
  return prisma.feedback.update({ where: { id }, data: payload });
};

const verifyFeedbackById = async (id: string, status: string) => {
  const validStatus = (status || 'verified') as FeedbackStatus;

  const result = await prisma.feedback.update({
    where: { id },
    data:  { adminVerified: validStatus },
  }).catch(() => null);

  if (!result) throw new AppError(httpStatus.BAD_REQUEST, 'User verification update failed');
  return result;
};

const deleteFeedback = async (id: string) => {
  return prisma.feedback.delete({ where: { id } }).catch(() => null);
};

export const FeedbackService = {
  createFeedback,
  getAllFeedbacks,
  getAllFeedbacksByAdmin,
  getFeedbackById,
  updateFeedback,
  verifyFeedbackById,
  deleteFeedback,
};
