import {
  AdminVerifiedStatus,
  DriverType,
  Gender,
  LoginWith,
  Prisma,
  User,
  UserRole,
  UserStatus,
} from '@prisma/client';

// ── Re-export Prisma-generated User type as the canonical user type ──────────
export type TUser = User;

// ── Address payload (used in register / profile update) ──────────────────────
export type TAddressPayload = {
  address?: string;
  lat?: number;
  lng?: number;
};

// ── Emergency contact ────────────────────────────────────────────────────────
export type TEmergencyContact = {
  id?: string;
  name: string;
  countryCode: string;
  phoneNumber: string;
};

// ── Type aliases matching original codebase references ──────────────────────
export type TUserRole    = UserRole;
export type TUserStatus  = UserStatus;
export type TAdminVerify = AdminVerifiedStatus;
export type TGender      = Gender;

// ── Create-user payload (registration) ──────────────────────────────────────
export interface TUserCreate {
  name?: string;
  email: string;
  password: string;
  countryCode?: string;
  phoneNumber?: string;
  role: UserRole;
  gender?: Gender;
  dateOfBirth?: Date;
  profileImage?: string;
  country?: string;
  homeAddress?: string;
  homeAddressLat?: number;
  homeAddressLng?: number;
  workAddress?: string;
  workAddressLat?: number;
  workAddressLng?: number;
  adminVerified?: AdminVerifiedStatus;
  driverType?: DriverType;
  acceptTerms?: boolean;
  fcmToken?: string;
  loginWith?: LoginWith;
  appleId?: string;
  
}

// ── Update-profile payload ───────────────────────────────────────────────────
export type TUserUpdate = Partial<TUserCreate> & {
  stripeCustomerId?: string;
  profileImage?: string;
  deviceIp?: string;
  deviceBrowser?: string;
  deviceOs?: string;
  deviceName?: string;
  deviceLastLogin?: string;
};

// ── Account-deletion payload ─────────────────────────────────────────────────
export interface DeleteAccountPayload {
  password: string;
}

// ── Pagination query ─────────────────────────────────────────────────────────
export interface IPaginationOption {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginateQuery {
  role?: string;
  page?: number;
  limit?: number;
  searchTerm?: string;
  [key: string]: unknown;
}

// ── Verified professional payload ────────────────────────────────────────────
export interface VerifiedProfessionalPayload {
  userId: string;
  status: 'pending' | 'verified';
}

// ── Super-admin creation ─────────────────────────────────────────────────────
export interface CreateSuperAdminProps {
  name: string;
  email: string;
  phone: string;
  password: string;
}

// ── JWT payload shape ────────────────────────────────────────────────────────
export interface JwtUserPayload {
  userId: string;
  name: string;
  email: string;
  role: UserRole;
  adminVerified: AdminVerifiedStatus;
  profileImage: string;
  homeAddress: string;
  isDriverProfileCompleted: boolean;
}

// ── Prisma select helper: user without password ──────────────────────────────
export const userPublicSelect = {
  id: true,
  name: true,
  email: true,
  countryCode: true,
  phoneNumber: true,
  role: true,
  gender: true,
  dateOfBirth: true,
  profileImage: true,
  country: true,
  homeAddress: true,
  homeAddressLat: true,
  homeAddressLng: true,
  workAddress: true,
  workAddressLat: true,
  workAddressLng: true,
  adminVerified: true,
  driverType: true,
  isDriverProfileCompleted: true,
  rating: true,
  totalReview: true,
  averageRating: true,
  wallet: true,
  status: true,
  accessibleRoutes: true,
  warningsCount: true,
  banReason: true,
  bannedAt: true,
  bannedById: true,
  isDeleted: true,
  acceptTerms: true,
  fcmToken: true,
  loginWith: true,
  appleId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
