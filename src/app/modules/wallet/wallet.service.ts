
import httpStatus from 'http-status';
import prisma from '../../config/prisma';
import AppError from '../../error/AppError';
import { TTransactionType, TTransactionSource, TWithdrawalMethod } from './wallet.interface';
import stripeClient from '../../utils/stripe';
import config from '../../config';

// ─────────────────────────────────────────────────────────────────────────────

const buildPagination = (query: Record<string, unknown>) => {
  const page  = Math.max(1, Number(query.page)  || 1);
  const limit = Math.max(1, Number(query.limit) || 10);
  return { skip: (page - 1) * limit, take: limit, page, limit };
};

// ─────────────────────────────────────────────────────────────────────────────

export const recordWalletTransaction = async ({
  userId,
  type,
  source,
  amount,
  description,
  rideId,
}: {
  userId:      string;
  type:        TTransactionType;
  source:      TTransactionSource;
  amount:      number;
  description: string;
  rideId?:     string;
}) => {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user) throw new AppError(httpStatus.NOT_FOUND, 'User not found');

    const balanceBefore = user.wallet ?? 0;
    const balanceAfter  = type === 'CREDIT'
      ? balanceBefore + amount
      : balanceBefore - amount;

    if (type === 'DEBIT' && balanceAfter < 0) {
      throw new AppError(httpStatus.BAD_REQUEST, 'Insufficient wallet balance');
    }

    await tx.user.update({ where: { id: userId }, data: { wallet: balanceAfter } });

    await tx.walletTransaction.create({
      data: { userId, type, source, amount, balanceBefore, balanceAfter, description, rideId: rideId ?? null },
    });

    return { balanceBefore, balanceAfter, amount };
  });
};

// ─────────────────────────────────────────────────────────────────────────────

const getMyWallet = async (userId: string, role: string) => {
  const isDriver = role === 'driver';

  const [user, driverDoc, pendingAgg, recentTransactions] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { wallet: true } }),
    isDriver
      ? prisma.driverProfile.findFirst({ where: { userId }, select: { walletBalance: true, totalEarnings: true, totalTrips: true } })
      : null,
    prisma.withdrawalRequest.aggregate({ where: { userId, status: 'PENDING' }, _sum: { amount: true } }),
    prisma.walletTransaction.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);

  if (!user) throw new AppError(httpStatus.NOT_FOUND, 'User not found');

  const pendingAmount    = pendingAgg._sum.amount ?? 0;
  const totalBalance     = isDriver ? (driverDoc?.walletBalance ?? 0) : (user.wallet ?? 0);
  const availableBalance = Math.max(0, totalBalance - pendingAmount);

  return {
    totalBalance,
    availableBalance,
    pendingWithdrawal: pendingAmount,
    ...(isDriver && driverDoc && {
      totalEarnings: driverDoc.totalEarnings ?? 0,
      totalTrips:    driverDoc.totalTrips    ?? 0,
    }),
    recentTransactions,
  };
};

// ─────────────────────────────────────────────────────────────────────────────

const getTransactionHistory = async (userId: string, query: Record<string, unknown>) => {
  const { skip, take, page, limit } = buildPagination(query);

  const [result, total] = await Promise.all([
    prisma.walletTransaction.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.walletTransaction.count({ where: { userId } }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

// ─────────────────────────────────────────────────────────────────────────────

const checkWithdrawalAmount = async (userId: string, role: string, amount: number) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { wallet: true } });
  if (!user) throw new AppError(httpStatus.NOT_FOUND, 'User not found');

  let totalBalance = user.wallet ?? 0;
  if (role === 'driver') {
    const driver = await prisma.driverProfile.findFirst({ where: { userId }, select: { walletBalance: true } });
    totalBalance = driver?.walletBalance ?? 0;
  }

  const pendingAgg    = await prisma.withdrawalRequest.aggregate({ where: { userId, status: 'PENDING' }, _sum: { amount: true } });
  const pendingAmount = pendingAgg._sum.amount ?? 0;
  const availableBalance = Math.max(0, totalBalance - pendingAmount);

  return {
    totalBalance,
    pendingWithdrawal: pendingAmount,
    availableBalance,
    requestedAmount:   amount,
    isAvailable:       amount > 0 && amount <= availableBalance,
  };
};

const requestWithdrawal = async (
  userId: string,
  role:   string,
  payload: {
    amount:         number;
    method:         TWithdrawalMethod;
    accountDetails: {
      accountName:   string;
      accountNumber: string;
      bankName?:     string;
      provider?:     string;
    };
  },
) => {
  const { amount, method, accountDetails } = payload;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { wallet: true } });
  if (!user) throw new AppError(httpStatus.NOT_FOUND, 'User not found');

  let totalBalance = user.wallet ?? 0;
  if (role === 'driver') {
    const driver = await prisma.driverProfile.findFirst({ where: { userId }, select: { walletBalance: true } });
    totalBalance = driver?.walletBalance ?? 0;
  }

  const pendingAgg    = await prisma.withdrawalRequest.aggregate({ where: { userId, status: 'PENDING' }, _sum: { amount: true } });
  const pendingAmount = pendingAgg._sum.amount ?? 0;
  const available     = Math.max(0, totalBalance - pendingAmount);

  if (amount <= 0) throw new AppError(httpStatus.BAD_REQUEST, 'Withdrawal amount must be greater than 0');
  if (amount > available) throw new AppError(httpStatus.BAD_REQUEST, `Insufficient available balance. Available: ${available}`);

  return prisma.withdrawalRequest.create({
    data: {
      userId,
      amount,
      method,
      accountName:   accountDetails.accountName,
      accountNumber: accountDetails.accountNumber,
      bankName:      accountDetails.bankName  ?? null,
      provider:      accountDetails.provider  ?? null,
      status:        'PENDING',
    },
  });
};

// ─────────────────────────────────────────────────────────────────────────────

const getMyWithdrawals = async (userId: string, query: Record<string, unknown>) => {
  const { skip, take, page, limit } = buildPagination(query);

  const [result, total] = await Promise.all([
    prisma.withdrawalRequest.findMany({
      where:   { userId },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
    prisma.withdrawalRequest.count({ where: { userId } }),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

// ─────────────────────────────────────────────────────────────────────────────

const adminGetAllWithdrawals = async (query: Record<string, unknown>) => {
  const { skip, take, page, limit } = buildPagination(query);

  const [result, total] = await Promise.all([
    prisma.withdrawalRequest.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: {
        user:        { select: { name: true, email: true, profileImage: true, phoneNumber: true, role: true } },
        processedBy: { select: { name: true, email: true } },
      },
    }),
    prisma.withdrawalRequest.count(),
  ]);

  return { meta: { page, limit, total, totalPage: Math.ceil(total / limit) }, result };
};

// ─────────────────────────────────────────────────────────────────────────────

const approveWithdrawal = async (withdrawalId: string, adminId: string) => {
  const request = await prisma.withdrawalRequest.findUnique({
    where:   { id: withdrawalId },
    include: { user: { select: { id: true, role: true } } },
  });

  if (!request) throw new AppError(httpStatus.NOT_FOUND, 'Withdrawal request not found');
  if (request.status !== 'PENDING') throw new AppError(httpStatus.BAD_REQUEST, `Request is already ${request.status}`);

  const { id: userId, role } = request.user;

  if (role === 'driver') {
    const driver = await prisma.driverProfile.findFirst({ where: { userId }, select: { id: true, walletBalance: true } });
    if (!driver) throw new AppError(httpStatus.NOT_FOUND, 'Driver profile not found');
    if (driver.walletBalance < request.amount) throw new AppError(httpStatus.BAD_REQUEST, 'Driver has insufficient wallet balance');

    await prisma.$transaction([
      prisma.driverProfile.update({
        where: { id: driver.id },
        data:  { walletBalance: { decrement: request.amount } },
      }),
      prisma.walletTransaction.create({
        data: {
          userId,
          type:          'DEBIT',
          source:        'WITHDRAWAL',
          amount:        request.amount,
          balanceBefore: driver.walletBalance,
          balanceAfter:  driver.walletBalance - request.amount,
          description:   `Withdrawal approved — ${request.method} to ${request.accountName}`,
        },
      }),
    ]);
  } else {
    await recordWalletTransaction({
      userId,
      type:        'DEBIT',
      source:      'WITHDRAWAL',
      amount:      request.amount,
      description: `Withdrawal approved — ${request.method} to ${request.accountName}`,
    });
  }

  return prisma.withdrawalRequest.update({
    where: { id: withdrawalId },
    data:  { status: 'APPROVED', processedById: adminId, processedAt: new Date() },
  });
};

// ─────────────────────────────────────────────────────────────────────────────

const rejectWithdrawal = async (withdrawalId: string, adminId: string, reason: string) => {
  const request = await prisma.withdrawalRequest.findUnique({ where: { id: withdrawalId } });
  if (!request) throw new AppError(httpStatus.NOT_FOUND, 'Withdrawal request not found');
  if (request.status !== 'PENDING') throw new AppError(httpStatus.BAD_REQUEST, `Request is already ${request.status}`);

  return prisma.withdrawalRequest.update({
    where: { id: withdrawalId },
    data:  { status: 'REJECTED', rejectionReason: reason, processedById: adminId, processedAt: new Date() },
  });
};

// ─────────────────────────────────────────────────────────────────────────────

const completeWithdrawal = async (withdrawalId: string, adminId: string) => {
  const request = await prisma.withdrawalRequest.findUnique({ where: { id: withdrawalId } });
  if (!request) throw new AppError(httpStatus.NOT_FOUND, 'Withdrawal request not found');
  if (request.status !== 'APPROVED') throw new AppError(httpStatus.BAD_REQUEST, 'Only approved requests can be marked as completed');

  return prisma.withdrawalRequest.update({
    where: { id: withdrawalId },
    data:  { status: 'COMPLETED', processedById: adminId, processedAt: new Date() },
  });
};

// ─────────────────────────────────────────────────────────────────────────────

const createTopUpCheckoutSession = async (userId: string, role: string, amount: number) => {
  if (!amount || amount <= 0) throw new AppError(httpStatus.BAD_REQUEST, 'Top-up amount must be greater than 0');

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new AppError(httpStatus.NOT_FOUND, 'User not found');

  const currency = config.stripe.stripe_currency as string;
  const zeroDecimalCurrencies = ['bif', 'clp', 'gnf', 'jpy', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'xaf', 'xof'];
  const stripeAmount = zeroDecimalCurrencies.includes(currency.toLowerCase())
    ? Math.round(amount)
    : Math.round(amount * 100);

  const session = await stripeClient.checkout.sessions.create({
    payment_method_types: ['card'],
    mode: 'payment',
    line_items: [{
      price_data: {
        currency,
        unit_amount: stripeAmount,
        product_data: {
          name: 'Mino Wallet Top-Up',
          description: `Add ${amount} ${currency.toUpperCase()} to your wallet`,
        },
      },
      quantity: 1,
    }],
    metadata: {
      type:   'WALLET_TOP_UP',
      userId,
      role,
      amount: String(amount),
    },
    success_url: `http://104.236.248.157:3000/wallet/topup/success`,
    cancel_url:  `http://104.236.248.157:3000/wallet/topup/cancel`,
  });

  return { checkoutUrl: session.url!, sessionId: session.id, amount, currency };
};

// ─────────────────────────────────────────────────────────────────────────────

export const WalletService = {
  getMyWallet,
  getTransactionHistory,
  createTopUpCheckoutSession,
  requestWithdrawal,
  getMyWithdrawals,
  adminGetAllWithdrawals,
  approveWithdrawal,
  rejectWithdrawal,
  completeWithdrawal,
};
