
import { Prisma, UserRole } from '@prisma/client';
import prisma from '../../config/prisma';

// ─────────────────────────────────────────────────────────────────────────────

const getTotalStatistics = async () => {
  const [totalUsers, totalPassengers, totalDrivers, earningAgg, recentUsers] = await Promise.all([
    prisma.user.count({ where: { isDeleted: false } }),
    prisma.user.count({ where: { role: UserRole.passenger, isDeleted: false } }),
    prisma.user.count({ where: { role: UserRole.driver,    isDeleted: false } }),
    prisma.ride.aggregate({
      where: { status: 'COMPLETED', isDeleted: false },
      _sum:  { adminCommission: true },
    }),
    prisma.user.findMany({
      where:   { isDeleted: false },
      select:  { name: true, email: true, role: true, status: true, profileImage: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take:    10,
    }),
  ]);

  return {
    totalUsers,
    totalPassengers,
    totalDrivers,
    totalEarnings: earningAgg._sum.adminCommission ?? 0,
    recentUsers,
  };
};

// ─────────────────────────────────────────────────────────────────────────────

type MonthRow = { month: number; count: bigint };

const getMonthlyUserOverview = async (role: 'passenger' | 'driver', year?: number) => {
  const targetYear = year ?? new Date().getFullYear();
  const from = new Date(`${targetYear}-01-01`);
  const to   = new Date(`${targetYear + 1}-01-01`);

  const rows = await prisma.$queryRaw<MonthRow[]>`
    SELECT EXTRACT(MONTH FROM "createdAt")::int AS month, COUNT(*)::bigint AS count
    FROM users
    WHERE "isDeleted" = false
      AND role::text = ${role}
      AND "createdAt" >= ${from}
      AND "createdAt" <  ${to}
    GROUP BY EXTRACT(MONTH FROM "createdAt")::int
    ORDER BY month
  `;

  const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, count: 0 }));
  for (const row of rows) {
    months[row.month - 1].count = Number(row.count);
  }

  return { year: targetYear, role, months };
};

// ─────────────────────────────────────────────────────────────────────────────

type EarningRow = {
  month:           number;
  totalRevenue:    number;
  adminCommission: number;
  driverEarning:   number;
  totalTips:       number;
  totalRides:      bigint;
};

const getEarningOverviewByYear = async (year?: number) => {
  const targetYear = year ?? new Date().getFullYear();
  const from = new Date(`${targetYear}-01-01`);
  const to   = new Date(`${targetYear + 1}-01-01`);

  const rows = await prisma.$queryRaw<EarningRow[]>`
    SELECT
      EXTRACT(MONTH FROM "createdAt")::int                   AS month,
      ROUND(SUM("totalFare")::numeric)::float                AS "totalRevenue",
      ROUND(SUM("adminCommission")::numeric)::float          AS "adminCommission",
      ROUND(SUM("driverEarning")::numeric)::float            AS "driverEarning",
      ROUND(SUM(COALESCE(tip, 0))::numeric)::float           AS "totalTips",
      COUNT(*)::bigint                                       AS "totalRides"
    FROM rides
    WHERE status::text = 'COMPLETED'
      AND "isDeleted" = false
      AND "createdAt" >= ${from}
      AND "createdAt" <  ${to}
    GROUP BY EXTRACT(MONTH FROM "createdAt")::int
    ORDER BY month
  `;

  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1, totalRevenue: 0, adminCommission: 0, driverEarning: 0, totalTips: 0, totalRides: 0,
  }));

  for (const row of rows) {
    const idx = row.month - 1;
    months[idx].totalRevenue    = row.totalRevenue    ?? 0;
    months[idx].adminCommission = row.adminCommission ?? 0;
    months[idx].driverEarning   = row.driverEarning   ?? 0;
    months[idx].totalTips       = row.totalTips       ?? 0;
    months[idx].totalRides      = Number(row.totalRides ?? 0);
  }

  return { year: targetYear, months };
};

// ─────────────────────────────────────────────────────────────────────────────

export const DashboardService = {
  getTotalStatistics,
  getMonthlyUserOverview,
  getEarningOverviewByYear,
};
