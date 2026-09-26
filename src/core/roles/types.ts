export interface CustomRoleItem {
  id: string;
  name: string;
  code: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoleInput {
  name: string;
  code: string;
  description?: string;
  permissions: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string;
  permissions?: string[];
}

export interface UserRoleAssignmentItem {
  userId: string;
  roleId: string;
  roleName: string;
  roleCode: string;
}
