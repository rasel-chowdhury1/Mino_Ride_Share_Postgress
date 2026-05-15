import bcrypt from 'bcrypt';
import { AdminVerifiedStatus, UserRole } from '@prisma/client';

import prisma from '../config/prisma';
import config from '../config';
import { USER_ROLE } from '../modules/user/user.constants';
import { setAdminData } from './adminStrore';

const createDefaultAdmin = async () => {
  const existingAdmin = await prisma.user.findFirst({
    where: { role: UserRole.admin, isDeleted: false },
  });

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash(
      config.admin_password as string,
      Number(config.bcrypt_salt_rounds),
    );

    const result = await prisma.user.create({
      data: {
        name:          'Admin',
        email:         config.admin_email    as string,
        password:      hashedPassword,
        phoneNumber:   config.admin_phone    as string,
        role:          UserRole.admin,
        adminVerified: AdminVerifiedStatus.verified,
        isDeleted:     false,
      },
    });

    setAdminData(result);
  } else {
    setAdminData(existingAdmin);
  }
};

export default createDefaultAdmin;
