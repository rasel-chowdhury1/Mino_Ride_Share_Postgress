import type { User } from '@prisma/client';

let adminData: User | null = null;

export const setAdminData = (data: User) => {
  adminData = data;
};

export const getAdminData = (): User | null => {
  return adminData;
};

export const getAdminId = (): string => {
  return adminData?.id ?? '';
};
