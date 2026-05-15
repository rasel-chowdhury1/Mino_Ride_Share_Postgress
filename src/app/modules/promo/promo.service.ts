
import { PromoStatus } from '@prisma/client';
import prisma from '../../config/prisma';
import AppError from '../../error/AppError';

interface IPromoPayload {
  title:          string;
  description?:   string;
  discount:       number;
  minimumSpend:   number;
  expirationDate: Date | string;
  status?:        PromoStatus;
  isDeleted?:     boolean;
}

const buildPagination = (query: Record<string, unknown>) => {
  const page  = Math.max(1, Number(query.page)  || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

const createPromo = async (payload: IPromoPayload) => {
  return prisma.promo.create({ data: { ...payload, expirationDate: new Date(payload.expirationDate) } });
};

const getAllPromos = async (query: Record<string, unknown>) => {
  const { skip, take, page, limit } = buildPagination(query);
  const searchTerm = query.searchTerm as string | undefined;

  const where = {
    isDeleted: false,
    ...(searchTerm && { title: { contains: searchTerm, mode: 'insensitive' as const } }),
  };

  const [result, total] = await Promise.all([
    prisma.promo.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.promo.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

const getPromoById = async (id: string) => {
  const promo = await prisma.promo.findFirst({ where: { id, isDeleted: false } });
  if (!promo) throw new AppError(404, 'Promo not found');
  return promo;
};

const updatePromo = async (id: string, payload: Partial<IPromoPayload>) => {
  const exists = await prisma.promo.findFirst({ where: { id, isDeleted: false } });
  if (!exists) throw new AppError(404, 'Promo not found');

  return prisma.promo.update({
    where: { id },
    data:  payload.expirationDate
      ? { ...payload, expirationDate: new Date(payload.expirationDate) }
      : payload,
  });
};

const deletePromo = async (id: string) => {
  const exists = await prisma.promo.findFirst({ where: { id } });
  if (!exists) throw new AppError(404, 'Promo not found');

  return prisma.promo.update({ where: { id }, data: { isDeleted: true, status: 'INACTIVE' } });
};

const getActivePromosForUser = async () => {
  return prisma.promo.findMany({
    where: {
      isDeleted:      false,
      status:         'ACTIVE',
      expirationDate: { gte: new Date() },
    },
    orderBy: { createdAt: 'desc' },
  });
};

export const PromoService = {
  createPromo,
  getAllPromos,
  getPromoById,
  updatePromo,
  deletePromo,
  getActivePromosForUser,
};
