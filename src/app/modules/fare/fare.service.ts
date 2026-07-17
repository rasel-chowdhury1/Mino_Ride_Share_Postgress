
import prisma from '../../config/prisma';
import AppError from '../../error/AppError';
import { IFare } from './fare.interface';

const buildPagination = (query: Record<string, unknown>) => {
  const page  = Math.max(1, Number(query.page)  || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

const createFare = async (payload: IFare) => {
  const exists = await prisma.fare.findUnique({ where: { country: payload.country.toUpperCase() } });
  if (exists) throw new AppError(400, 'Fare configuration already exists for this country');

  return prisma.fare.create({ data: { ...payload, country: payload.country.toUpperCase() } });
};

const getAllFares = async (query: Record<string, unknown>) => {
  const { skip, take, page, limit } = buildPagination(query);
  const searchTerm = query.searchTerm as string | undefined;

  const where = {
    isDeleted: false,
    ...(searchTerm && { country: { contains: searchTerm, mode: 'insensitive' as const } }),
  };

  const [result, total] = await Promise.all([
    prisma.fare.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.fare.count({ where }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

const getFareByCountry = async (country: string) => {
  const fare = await prisma.fare.findUnique({ where: { country: country.toUpperCase() } });
  if (!fare) throw new AppError(404, 'Fare configuration not found');
  return fare;
};

const updateFare = async (id: string, payload: Partial<IFare>) => {
  const updated = await prisma.fare.update({
    where: { id },
    data:  payload,
  }).catch(() => null);

  if (!updated) throw new AppError(404, 'Fare configuration not found');
  return updated;
};

const deleteFare = async (id: string) => {
  const existing = await prisma.fare.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'Fare configuration not found');

  return prisma.fare.delete({ where: { id } });
};

export const FareService = {
  createFare,
  getAllFares,
  getFareByCountry,
  updateFare,
  deleteFare,
};
