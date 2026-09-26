import { redirect } from "next/navigation";
import { requireSession } from "@/core/auth/session";
import { getEffectiveUserPermissionsService } from "@/core/auth/permissions";
import { listDepartmentsService, listTeamMembersService } from "@/core/team/service";
import { listDirectoryConfigsService } from "@/core/workplace/directory-sync";
import { listRolesService, listUserRoleAssignmentsService } from "@/core/roles/service";
import TeamManagementClient from "./TeamManagementClient";

export const metadata = {
  title: "团队管理 - 商脉AI CRM",
  description: "企业团队组织架构、员工花名册与角色权限体系，支持企业微信/钉钉通讯录同步",
};

export default async function TeamPage() {
  const session = await requireSession().catch(() => null);
  if (!session) redirect("/login");

  if (session.role === "SALES") {
    redirect("/today");
  }

  const [members, departments, directoryConfigs, roles, roleAssignments, permissions] = await Promise.all([
    listTeamMembersService(session),
    listDepartmentsService(session),
    listDirectoryConfigsService(session),
    listRolesService(session),
    listUserRoleAssignmentsService(session),
    getEffectiveUserPermissionsService(session),
  ]);

  return (
    <TeamManagementClient
      initialMembers={members}
      initialDepartments={departments}
      initialDirectoryConfigs={directoryConfigs}
      initialRoles={roles}
      initialRoleAssignments={roleAssignments}
      permissions={permissions}
      role={session.role}
      currentUserId={session.userId}
    />
  );
}
