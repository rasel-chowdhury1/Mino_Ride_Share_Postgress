import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import config from './index';

const globalForPrisma = globalThis as unknown as { 
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = config.database_url;

  if (!connectionString) {
    throw new Error('❌ DATABASE_URL environment variable is not set');
  }

  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: config.NODE_ENV === 'development' 
      ? ['error', 'warn'] 
      : ['error'],
  });
}

const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (config.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

export default prisma;
