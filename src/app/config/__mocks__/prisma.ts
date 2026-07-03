import { PrismaClient } from '@prisma/client';
import { mockDeep, DeepMockProxy } from 'jest-mock-extended';

const prisma = mockDeep<PrismaClient>();

export default prisma;
export type PrismaMock = DeepMockProxy<PrismaClient>;
