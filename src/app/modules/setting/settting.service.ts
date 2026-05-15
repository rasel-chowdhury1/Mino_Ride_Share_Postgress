
import { SettingKey } from '@prisma/client';
import prisma from '../../config/prisma';

type TSettingKey = SettingKey;

const getSettings = async () => {
  return prisma.setting.findMany({ orderBy: { createdAt: 'desc' } });
};

const getSettingsByKey = async (payload: { key: TSettingKey }) => {
  return prisma.setting.findFirst({ where: { key: payload.key } });
};

const updateSettingsByKey = async (key: TSettingKey, content: string) => {
  return prisma.setting.upsert({
    where:  { key },
    update: { content },
    create: { key, content },
  });
};

export const settingsService = {
  getSettings,
  getSettingsByKey,
  updateSettingsByKey,
};
