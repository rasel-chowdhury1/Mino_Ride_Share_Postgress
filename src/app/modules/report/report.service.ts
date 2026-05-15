
import { ReportStatus } from '@prisma/client';
import httpStatus from 'http-status';
import AppError from '../../error/AppError';
import prisma from '../../config/prisma';

const buildPagination = (query: Record<string, unknown>) => {
  const page  = Math.max(1, Number(query.page)  || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

// ─────────────────────────────────────────────────────────────────────────────

const createReport = async (
  reportedById: string,
  payload: { rideId: string; reportedUser: string; reason: string; details?: string },
) => {
  return prisma.report.create({
    data: {
      rideId:         payload.rideId,
      reportedById,
      reportedUserId: payload.reportedUser,
      reason:         payload.reason,
      details:        payload.details,
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────

const getMyReports = async (userId: string, query: Record<string, unknown>) => {
  const { skip, take, page, limit } = buildPagination(query);

  const where = { reportedById: userId, isDeleted: false };

  const [result, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        ride:         { select: { rideId: true, status: true, pickupAddress: true, dropoffAddress: true } },
        reportedUser: { select: { name: true, profileImage: true } },
      },
    }),
    prisma.report.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

// ─────────────────────────────────────────────────────────────────────────────

const getAllReports = async (query: Record<string, unknown>) => {
  const { skip, take, page, limit } = buildPagination(query);
  const searchTerm = query.searchTerm as string | undefined;

  const where = {
    isDeleted: false,
    ...(searchTerm && {
      OR: [
        { reason: { contains: searchTerm, mode: 'insensitive' as const } },
        { status: { equals: searchTerm.toLowerCase() as ReportStatus } },
      ],
    }),
  };

  const [result, total] = await Promise.all([
    prisma.report.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        ride:         { select: { rideId: true, status: true } },
        reportedBy:   { select: { name: true, profileImage: true, role: true } },
        reportedUser: { select: { name: true, profileImage: true, role: true } },
      },
    }),
    prisma.report.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

// ─────────────────────────────────────────────────────────────────────────────

const updateReportStatus = async (reportId: string, status: ReportStatus) => {
  const report = await prisma.report.update({
    where: { id: reportId },
    data:  { status },
  }).catch(() => null);

  if (!report) throw new AppError(httpStatus.NOT_FOUND, 'Report not found');
  return report;
};

// ─────────────────────────────────────────────────────────────────────────────

export const ReportService = {
  createReport,
  getMyReports,
  getAllReports,
  updateReportStatus,
};
