import type { Role } from "@/core/auth/types";

export type DepartmentItem = {
  id: string;
  name: string;
  parentId: string | null;
  leaderUserId: string | null;
  leaderName?: string | null;
  sortOrder: number;
  memberCount: number;
  createdAt: string;
};

export type TeamMemberItem = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  employeeNo: string | null;
  jobTitle: string | null;
  role: Role;
  status: "ACTIVE" | "DISABLED";
  departmentId: string | null;
  departmentName: string | null;
  maxLeadQuota: number;
  activeLeadsCount: number;
  activeCustomersCount: number;
  activeDealsCount: number;
  createdAt: string;
};

export type CreateTeamMemberInput = {
  name: string;
  email: string;
  phone?: string;
  employeeNo?: string;
  jobTitle?: string;
  role: Role;
  departmentId?: string | null;
  maxLeadQuota?: number;
  password?: string;
};

export type UpdateTeamMemberInput = {
  userId: string;
  name?: string;
  phone?: string;
  employeeNo?: string;
  jobTitle?: string;
  role?: Role;
  departmentId?: string | null;
  maxLeadQuota?: number;
  status?: "ACTIVE" | "DISABLED";
};

export type BatchImportUserRow = {
  name: string;
  email: string;
  phone?: string;
  role: string;
  departmentName?: string;
  employeeNo?: string;
  maxLeadQuota?: number;
};

export type BatchImportResult = {
  total: number;
  createdCount: number;
  skippedCount: number;
  errors: Array<{ row: number; email?: string; reason: string }>;
};

export type OffboardingTransferInput = {
  offboardUserId: string;
  transferToUserId: string | null;
  action: "TRANSFER" | "RETURN_TO_POOL";
};

export type OffboardingAssetSummary = {
  userId: string;
  userName: string;
  leadsCount: number;
  customersCount: number;
  dealsCount: number;
};
