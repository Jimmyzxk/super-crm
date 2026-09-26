"use client";

import { useMemo, useState, useTransition } from "react";
import type { Role } from "@/core/auth/types";
import {
  createDepartmentAction,
  createTeamMemberAction,
  deleteDepartmentAction,
  getOffboardingAssetSummaryAction,
  listTeamMembersAction,
  offboardMemberAndTransferAssetsAction,
  updateDepartmentAction,
  updateTeamMemberAction,
} from "@/core/team/actions";
import type {
  CreateTeamMemberInput,
  DepartmentItem,
  OffboardingAssetSummary,
  TeamMemberItem,
  UpdateTeamMemberInput,
} from "@/core/team/types";

import type { WorkplaceDirectoryConfigItem } from "@/core/workplace/directory-sync";
import WorkplaceDirectorySyncModal from "./WorkplaceDirectorySyncModal";

import type { CustomRoleItem, UserRoleAssignmentItem } from "@/core/roles/types";
import {
  assignUserRolesAction,
  createRoleAction,
  deleteRoleAction,
  listRolesAction,
  listUserRoleAssignmentsAction,
  updateRoleAction,
} from "@/core/roles/actions";
import {
  ALL_PERMISSION_DEFINITIONS,
  PERMISSION_CATEGORY_NAMES,
  PERMISSIONS,
} from "@/core/auth/permission-constants";
import { Button, Badge } from "@/components/ui";

type Props = {
  initialMembers: TeamMemberItem[];
  initialDepartments: DepartmentItem[];
  initialDirectoryConfigs?: WorkplaceDirectoryConfigItem[];
  initialRoles?: CustomRoleItem[];
  initialRoleAssignments?: UserRoleAssignmentItem[];
  permissions?: string[];
  role: Role;
  currentUserId: string;
};

const ROLE_LABELS: Record<Role, { label: string; bg: string; text: string; border: string }> = {
  ADMIN: { label: "超级管理员", bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200" },
  MANAGER: { label: "业务主管", bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
  SALES: { label: "销售专员", bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200" },
};

export default function TeamManagementClient({
  initialMembers,
  initialDepartments,
  initialDirectoryConfigs = [],
  initialRoles = [],
  initialRoleAssignments = [],
  role,
  currentUserId,
}: Props) {
  const isAdmin = role === "ADMIN";
  const [activeMainTab, setActiveMainTab] = useState<"MEMBERS" | "ROLES">("MEMBERS");

  // 成员与部门状态
  const [members, setMembers] = useState<TeamMemberItem[]>(initialMembers);
  const [departments, setDepartments] = useState<DepartmentItem[]>(initialDepartments);
  const [directoryConfigs] = useState<WorkplaceDirectoryConfigItem[]>(initialDirectoryConfigs);
  const [showDirectorySyncModal, setShowDirectorySyncModal] = useState(false);
  const [isPending, startTransition] = useTransition();

  // 角色与权限状态
  const [roles, setRoles] = useState<CustomRoleItem[]>(initialRoles);
  const [roleAssignments, setRoleAssignments] = useState<UserRoleAssignmentItem[]>(initialRoleAssignments);
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRoleItem | null>(null);
  const [roleForm, setRoleForm] = useState<{
    name: string;
    code: string;
    description: string;
    permissions: string[];
  }>({
    name: "",
    code: "",
    description: "",
    permissions: [],
  });

  // 筛选器状态
  const [selectedDeptId, setSelectedDeptId] = useState<string>("ALL");
  const [roleFilter, setRoleFilter] = useState<string>("ALL");
  const [statusFilter, setStatusFilter] = useState<string>("ACTIVE");
  const [searchQuery, setSearchQuery] = useState("");
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  // 成员弹窗状态
  const [showMemberModal, setShowMemberModal] = useState(false);
  const [editingMember, setEditingMember] = useState<TeamMemberItem | null>(null);
  const [selectedMemberCustomRoleIds, setSelectedMemberCustomRoleIds] = useState<string[]>([]);
  const [memberForm, setMemberForm] = useState<CreateTeamMemberInput>({
    name: "",
    email: "",
    phone: "",
    employeeNo: "",
    jobTitle: "",
    role: "SALES",
    departmentId: "",
    maxLeadQuota: 100,
  });

  // 部门弹窗
  const [showDeptModal, setShowDeptModal] = useState(false);
  const [editingDept, setEditingDept] = useState<DepartmentItem | null>(null);
  const [deptName, setDeptName] = useState("");
  const [deptLeaderId, setDeptLeaderId] = useState("");

  // 离职交接向导
  const [showOffboardModal, setShowOffboardModal] = useState(false);
  const [offboardTarget, setOffboardTarget] = useState<TeamMemberItem | null>(null);
  const [offboardSummary, setOffboardSummary] = useState<OffboardingAssetSummary | null>(null);
  const [transferStrategy, setTransferStrategy] = useState<"TRANSFER" | "RETURN_TO_POOL">("TRANSFER");
  const [transferToUserId, setTransferToUserId] = useState<string>("");

  // 消息提示
  function notify(msg: string) {
    setActionFeedback(msg);
    setTimeout(() => setActionFeedback(null), 3500);
  }

  // 重新加载成员数据
  function reloadMembers() {
    startTransition(async () => {
      const res = await listTeamMembersAction();
      if (res.ok) setMembers(res.data);
    });
  }

  // 重新加载角色数据
  function reloadRoles() {
    startTransition(async () => {
      const [rRes, aRes] = await Promise.all([
        listRolesAction(),
        listUserRoleAssignmentsAction(),
      ]);
      if (rRes.ok) setRoles(rRes.data);
      if (aRes.ok) setRoleAssignments(aRes.data);
    });
  }

  // 打开创建成员弹窗
  function handleOpenCreateMember() {
    setEditingMember(null);
    setSelectedMemberCustomRoleIds([]);
    setMemberForm({
      name: "",
      email: "",
      phone: "",
      employeeNo: "",
      jobTitle: "",
      role: "SALES",
      departmentId: selectedDeptId !== "ALL" && selectedDeptId !== "NONE" ? selectedDeptId : "",
      maxLeadQuota: 100,
    });
    setShowMemberModal(true);
  }

  // 打开编辑成员弹窗
  function handleOpenEditMember(m: TeamMemberItem) {
    setEditingMember(m);
    const assignedIds = roleAssignments.filter((ra) => ra.userId === m.id).map((ra) => ra.roleId);
    setSelectedMemberCustomRoleIds(assignedIds);
    setMemberForm({
      name: m.name,
      email: m.email,
      phone: m.phone || "",
      employeeNo: m.employeeNo || "",
      jobTitle: m.jobTitle || "",
      role: m.role,
      departmentId: m.departmentId || "",
      maxLeadQuota: m.maxLeadQuota,
    });
    setShowMemberModal(true);
  }

  // 提交成员表单
  function handleSaveMember() {
    if (!memberForm.name.trim()) return alert("请输入姓名");
    if (!editingMember && !memberForm.email.trim()) return alert("请输入邮箱");

    startTransition(async () => {
      if (editingMember) {
        const payload: UpdateTeamMemberInput = {
          userId: editingMember.id,
          name: memberForm.name,
          phone: memberForm.phone || undefined,
          employeeNo: memberForm.employeeNo || undefined,
          jobTitle: memberForm.jobTitle || undefined,
          role: memberForm.role,
          departmentId: memberForm.departmentId || null,
          maxLeadQuota: Number(memberForm.maxLeadQuota) || 100,
        };
        const res = await updateTeamMemberAction(payload);
        if (res.ok) {
          // 同步分配的自定义角色
          await assignUserRolesAction(editingMember.id, selectedMemberCustomRoleIds);
          notify("成员信息与角色权限已更新");
          setShowMemberModal(false);
          reloadMembers();
          reloadRoles();
        } else {
          alert(res.message || "更新失败");
        }
      } else {
        const res = await createTeamMemberAction({
          ...memberForm,
          departmentId: memberForm.departmentId || null,
          maxLeadQuota: Number(memberForm.maxLeadQuota) || 100,
        });
        if (res.ok) {
          if (selectedMemberCustomRoleIds.length > 0) {
            await assignUserRolesAction(res.data.id, selectedMemberCustomRoleIds);
          }
          notify(`成员 ${res.data.name} 已添加，初始密码为 Password123456`);
          setShowMemberModal(false);
          reloadMembers();
          reloadRoles();
        } else {
          alert(res.message || "创建失败");
        }
      }
    });
  }

  // 打开创建角色弹窗
  function handleOpenCreateRole() {
    setEditingRole(null);
    setRoleForm({
      name: "",
      code: "",
      description: "",
      permissions: [PERMISSIONS.PRODUCTS_VIEW, PERMISSIONS.LEADS_CLAIM],
    });
    setShowRoleModal(true);
  }

  // 打开编辑角色弹窗
  function handleOpenEditRole(roleItem: CustomRoleItem) {
    setEditingRole(roleItem);
    setRoleForm({
      name: roleItem.name,
      code: roleItem.code,
      description: roleItem.description || "",
      permissions: roleItem.permissions || [],
    });
    setShowRoleModal(true);
  }

  // 提交角色表单
  function handleSaveRole() {
    if (!roleForm.name.trim()) return alert("请输入角色名称");
    if (!editingRole && !roleForm.code.trim()) return alert("请输入角色标识编码");

    startTransition(async () => {
      if (editingRole) {
        const res = await updateRoleAction(editingRole.id, {
          name: roleForm.name,
          description: roleForm.description,
          permissions: roleForm.permissions,
        });
        if (res.ok) {
          notify(`角色 "${res.data.name}" 权限已更新`);
          setShowRoleModal(false);
          reloadRoles();
        } else {
          alert(res.message || "更新角色失败");
        }
      } else {
        const res = await createRoleAction({
          name: roleForm.name,
          code: roleForm.code,
          description: roleForm.description,
          permissions: roleForm.permissions,
        });
        if (res.ok) {
          notify(`自定义角色 "${res.data.name}" 创建成功`);
          setShowRoleModal(false);
          reloadRoles();
        } else {
          alert(res.message || "创建角色失败");
        }
      }
    });
  }

  // 删除角色
  function handleDeleteRole(roleId: string, roleName: string) {
    if (!confirm(`确认删除自定义角色 "${roleName}"？删除后已绑定该角色的员工将失去对应扩展权限。`)) return;
    startTransition(async () => {
      const res = await deleteRoleAction(roleId);
      if (res.ok) {
        notify(res.data.message);
        reloadRoles();
      } else {
        alert(res.message || "删除角色失败");
      }
    });
  }

  // 切换单个权限勾选
  function toggleRolePermission(pKey: string) {
    setRoleForm((prev) => {
      const exists = prev.permissions.includes(pKey);
      return {
        ...prev,
        permissions: exists ? prev.permissions.filter((p) => p !== pKey) : [...prev.permissions, pKey],
      };
    });
  }

  // 分类全选 / 反选
  function toggleCategoryPermissions(category: string, allSelected: boolean) {
    const categoryKeys: string[] = ALL_PERMISSION_DEFINITIONS.filter((p) => p.category === category).map((p) => p.key);
    setRoleForm((prev) => {
      if (allSelected) {
        return {
          ...prev,
          permissions: prev.permissions.filter((p) => !categoryKeys.includes(p)),
        };
      } else {
        return {
          ...prev,
          permissions: Array.from(new Set([...prev.permissions, ...categoryKeys])),
        };
      }
    });
  }

  // 打开离职交接向导
  function handleOpenOffboard(m: TeamMemberItem) {
    setOffboardTarget(m);
    setTransferToUserId("");
    setTransferStrategy("TRANSFER");
    startTransition(async () => {
      const res = await getOffboardingAssetSummaryAction(m.id);
      if (res.ok) {
        setOffboardSummary(res.data);
        setShowOffboardModal(true);
      } else {
        alert(res.message || "获取交接资产失败");
      }
    });
  }

  // 执行离职交接
  function handleExecuteOffboard() {
    if (!offboardTarget) return;
    if (transferStrategy === "TRANSFER" && !transferToUserId) {
      return alert("请选择资产接手人");
    }

    startTransition(async () => {
      const res = await offboardMemberAndTransferAssetsAction({
        offboardUserId: offboardTarget.id,
        transferToUserId: transferStrategy === "TRANSFER" ? transferToUserId : null,
        action: transferStrategy,
      });

      if (res.ok) {
        notify(`员工 ${offboardTarget.name} 离职资产交接已完成，账号已注销`);
        setShowOffboardModal(false);
        reloadMembers();
      } else {
        alert(res.message || "交接处理失败");
      }
    });
  }

  // 保存部门
  function handleSaveDept() {
    if (!deptName.trim()) return alert("请输入部门名称");
    startTransition(async () => {
      if (editingDept) {
        const res = await updateDepartmentAction({
          id: editingDept.id,
          name: deptName,
          leaderUserId: deptLeaderId || null,
        });
        if (res.ok) {
          notify("部门已更新");
          setShowDeptModal(false);
          setDepartments((prev) =>
            prev.map((d) => (d.id === editingDept.id ? { ...d, name: deptName, leaderUserId: deptLeaderId || null } : d))
          );
        } else {
          alert(res.message || "更新失败");
        }
      } else {
        const res = await createDepartmentAction({
          name: deptName,
          leaderUserId: deptLeaderId || null,
        });
        if (res.ok) {
          notify(`部门 "${res.data.name}" 已创建`);
          setShowDeptModal(false);
          setDepartments((prev) => [...prev, { ...res.data, memberCount: 0 }]);
        } else {
          alert(res.message || "创建失败");
        }
      }
    });
  }

  // 删除部门
  function handleDeleteDept(deptId: string) {
    if (!confirm("确认删除此部门？部门下成员将变为【未分配部门】状态。")) return;
    startTransition(async () => {
      const res = await deleteDepartmentAction(deptId);
      if (res.ok) {
        notify("部门已删除");
        setShowDeptModal(false);
        setDepartments((prev) => prev.filter((d) => d.id !== deptId));
        if (selectedDeptId === deptId) setSelectedDeptId("ALL");
        reloadMembers();
      } else {
        alert(res.message || "删除失败");
      }
    });
  }

  // 客户端筛选计算
  const filteredMembers = useMemo(() => {
    return members.filter((m) => {
      if (selectedDeptId !== "ALL") {
        if (selectedDeptId === "NONE" && m.departmentId !== null) return false;
        if (selectedDeptId !== "NONE" && m.departmentId !== selectedDeptId) return false;
      }
      if (roleFilter !== "ALL" && m.role !== roleFilter) return false;
      if (statusFilter !== "ALL" && m.status !== statusFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const match =
          m.name.toLowerCase().includes(q) ||
          m.email.toLowerCase().includes(q) ||
          (m.phone && m.phone.includes(q)) ||
          (m.employeeNo && m.employeeNo.toLowerCase().includes(q));
        if (!match) return false;
      }
      return true;
    });
  }, [members, selectedDeptId, roleFilter, statusFilter, searchQuery]);

  // 统计指标
  const activeMembersCount = useMemo(() => members.filter((m) => m.status === "ACTIVE").length, [members]);

  // 权限分类定义
  const permissionCategories = useMemo(() => {
    const catMap = new Map<string, typeof ALL_PERMISSION_DEFINITIONS>();
    for (const p of ALL_PERMISSION_DEFINITIONS) {
      if (!catMap.has(p.category)) catMap.set(p.category, []);
      catMap.get(p.category)!.push(p);
    }
    return Array.from(catMap.entries());
  }, []);

  return (
    <div className="space-y-5">
      {/* 顶部标题与 Tab 导航 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200/80 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              系统治理
            </span>
            <h1 className="text-xl font-bold text-slate-950 tracking-tight">
              团队管理
            </h1>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700 font-mono">
              {members.length} 人
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            统一维护组织架构、员工花名册与角色权限体系，支持企业微信/钉钉通讯录同步
          </p>
        </div>

        {/* 顶部主 Tab 切换 */}
        <div className="flex items-center gap-1.5 bg-slate-100/90 p-1 rounded-lg border border-slate-200/70 shadow-2xs">
          <button
            type="button"
            onClick={() => setActiveMainTab("MEMBERS")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${
              activeMainTab === "MEMBERS"
                ? "bg-white text-slate-950 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>成员与部门</span>
            <span className="bg-slate-200/70 text-slate-700 px-1.5 py-0.2 rounded-full text-[10px] font-mono">
              {members.length}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setActiveMainTab("ROLES")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition ${
              activeMainTab === "ROLES"
                ? "bg-white text-indigo-700 shadow-2xs font-bold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <span>角色与权限</span>
            <span className="bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded-full text-[10px] font-mono">
              {roles.length}
            </span>
          </button>
        </div>
      </div>

      {/* 消息提示通知条 */}
      {actionFeedback && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-semibold text-emerald-800 flex items-center justify-between animate-fadeIn">
          <span>{actionFeedback}</span>
          <button onClick={() => setActionFeedback(null)} className="text-emerald-600 hover:text-emerald-950 font-bold">×</button>
        </div>
      )}

      {/* ======================================================== */}
      {/* VIEW 1: 组织架构与成员花名册                               */}
      {/* ======================================================== */}
      {activeMainTab === "MEMBERS" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">
                在职成员: <strong className="text-slate-900">{activeMembersCount}</strong> 人
              </span>
              <span className="text-slate-300">|</span>
              <span className="text-xs text-slate-500">
                部门数: <strong className="text-slate-900">{departments.length}</strong> 个
              </span>
            </div>

            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="secondary"
                  size="md"
                  onClick={() => setShowDirectorySyncModal(true)}
                >
                  通讯录自动同步
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={handleOpenCreateMember}
                  leftIcon={
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                  }
                >
                  添加新成员
                </Button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* 左侧部门导航卡片 */}
            <div className="lg:col-span-3 space-y-3">
              <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs space-y-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-2.5">
                  <span className="text-xs font-bold text-slate-800">组织部门架构</span>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingDept(null);
                        setDeptName("");
                        setDeptLeaderId("");
                        setShowDeptModal(true);
                      }}
                      className="text-[11px] font-semibold text-blue-600 hover:text-blue-800"
                    >
                      + 新增部门
                    </button>
                  )}
                </div>

                <nav className="space-y-1">
                  <button
                    type="button"
                    onClick={() => setSelectedDeptId("ALL")}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                      selectedDeptId === "ALL"
                        ? "bg-slate-900 text-white font-bold"
                        : "text-slate-700 hover:bg-slate-100"
                    }`}
                  >
                    <span>全部部门员工</span>
                    <span className="font-mono text-[11px]">{members.length}</span>
                  </button>

                  {departments.map((dept) => {
                    const count = members.filter((m) => m.departmentId === dept.id).length;
                    const isSelected = selectedDeptId === dept.id;
                    return (
                      <div
                        key={dept.id}
                        className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition ${
                          isSelected
                            ? "bg-slate-900 text-white font-bold"
                            : "text-slate-700 hover:bg-slate-100"
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => setSelectedDeptId(dept.id)}
                          className="flex-1 text-left truncate flex items-center gap-1.5"
                        >
                          <span className="truncate">{dept.name}</span>
                          {dept.leaderName && (
                            <span className={`text-[10px] ${isSelected ? "text-slate-300" : "text-slate-400"}`}>
                              ({dept.leaderName})
                            </span>
                          )}
                        </button>
                        <div className="flex items-center gap-1">
                          <span className={`font-mono text-[11px] ${isSelected ? "text-slate-200" : "text-slate-400"}`}>
                            {count}
                          </span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingDept(dept);
                                setDeptName(dept.name);
                                setDeptLeaderId(dept.leaderUserId || "");
                                setShowDeptModal(true);
                              }}
                              className={`opacity-0 group-hover:opacity-100 text-[10px] ${
                                isSelected ? "text-slate-300 hover:text-white" : "text-slate-400 hover:text-slate-700"
                              }`}
                            >
                              编辑
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setSelectedDeptId("NONE")}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition ${
                      selectedDeptId === "NONE"
                        ? "bg-slate-900 text-white font-bold"
                        : "text-slate-500 hover:bg-slate-100"
                    }`}
                  >
                    <span>未分配部门</span>
                    <span className="font-mono text-[11px]">
                      {members.filter((m) => !m.departmentId).length}
                    </span>
                  </button>
                </nav>
              </div>
            </div>

            {/* 右侧成员花名册与治理表格 */}
            <div className="lg:col-span-9 space-y-3">
              {/* 筛选与搜索工具条 */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-2.5 shadow-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-1 p-0.5 bg-slate-100 rounded-lg border border-slate-200/70">
                    <button
                      type="button"
                      onClick={() => setStatusFilter("ACTIVE")}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                        statusFilter === "ACTIVE"
                          ? "bg-white text-slate-900 shadow-2xs font-bold"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      在职成员 ({activeMembersCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter("DISABLED")}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                        statusFilter === "DISABLED"
                          ? "bg-white text-slate-900 shadow-2xs font-bold"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      已停用 ({members.length - activeMembersCount})
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatusFilter("ALL")}
                      className={`px-2.5 py-1 rounded-md text-xs font-semibold transition ${
                        statusFilter === "ALL"
                          ? "bg-white text-slate-900 shadow-2xs font-bold"
                          : "text-slate-500 hover:text-slate-900"
                      }`}
                    >
                      全量
                    </button>
                  </div>

                  <select
                    value={roleFilter}
                    onChange={(e) => setRoleFilter(e.target.value)}
                    className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 shadow-2xs focus:border-slate-900 focus:outline-none"
                  >
                    <option value="ALL">全部基础角色</option>
                    <option value="ADMIN">超级管理员</option>
                    <option value="MANAGER">业务主管</option>
                    <option value="SALES">销售专员</option>
                  </select>
                </div>

                <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
                  <svg className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜索姓名、邮箱、手机或工号..."
                    className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-3 text-xs text-slate-800 placeholder:text-slate-400 shadow-2xs focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* 成员表格 */}
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xs">
                <table className="w-full text-left text-xs text-slate-700">
                  <thead className="border-b border-slate-100 bg-slate-50/75 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                    <tr>
                      <th className="px-3.5 py-3">成员信息</th>
                      <th className="px-3 py-3">所属部门 / 职务</th>
                      <th className="px-3 py-3">角色与已授权限</th>
                      <th className="px-3 py-3 text-center">私海配额</th>
                      <th className="px-3 py-3 text-center">在管资产</th>
                      <th className="px-3 py-3">状态</th>
                      {isAdmin && <th className="px-3 py-3 text-right">操作治理</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredMembers.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-8 text-center text-slate-400 text-xs">
                          暂无符合条件的成员记录
                        </td>
                      </tr>
                    ) : (
                      filteredMembers.map((m) => {
                        const roleCfg = ROLE_LABELS[m.role] || ROLE_LABELS.SALES;
                        const isSelf = m.id === currentUserId;
                        const assignedCustomRoles = roleAssignments.filter((ra) => ra.userId === m.id);

                        return (
                          <tr key={m.id} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-3.5 py-3">
                              <div className="flex items-center gap-2.5">
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-900 truncate flex items-center gap-1.5">
                                    {m.name}
                                    {isSelf && (
                                      <Badge variant="neutral" size="sm">
                                        当前账号
                                      </Badge>
                                    )}
                                  </p>
                                  <p className="text-[11px] text-slate-400 truncate mt-0.5">{m.email}</p>
                                </div>
                              </div>
                            </td>

                            <td className="px-3 py-3">
                              <p className="font-medium text-slate-800 truncate">{m.departmentName || "未分配"}</p>
                              <p className="text-[11px] text-slate-400 truncate mt-0.5">{m.jobTitle || "业务顾问"}</p>
                            </td>

                            <td className="px-3 py-3">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <Badge
                                  variant={m.role === "ADMIN" ? "purple" : m.role === "MANAGER" ? "blue" : "emerald"}
                                  size="sm"
                                >
                                  {roleCfg.label}
                                </Badge>
                                {assignedCustomRoles.map((cr) => (
                                  <Badge
                                    key={cr.roleId}
                                    variant="purple"
                                    size="sm"
                                  >
                                    +{cr.roleName}
                                  </Badge>
                                ))}
                              </div>
                            </td>

                            <td className="px-3 py-3 text-center font-mono font-semibold text-slate-900">
                              {m.maxLeadQuota} 户
                            </td>

                            <td className="px-3 py-3 text-center">
                              <span className="font-mono text-slate-600">
                                {m.activeLeadsCount} / {m.activeCustomersCount} / {m.activeDealsCount}
                              </span>
                            </td>

                            <td className="px-3 py-3">
                              <Badge
                                variant={m.status === "ACTIVE" ? "emerald" : "neutral"}
                                dot
                                size="sm"
                              >
                                {m.status === "ACTIVE" ? "在职" : "已停用"}
                              </Badge>
                            </td>

                            {isAdmin && (
                              <td className="px-3 py-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <Button
                                    variant="secondary"
                                    size="xs"
                                    onClick={() => handleOpenEditMember(m)}
                                  >
                                    编辑/授权
                                  </Button>
                                  {m.status === "ACTIVE" && !isSelf && (
                                    <Button
                                      variant="danger"
                                      size="xs"
                                      onClick={() => handleOpenOffboard(m)}
                                    >
                                      离职交接
                                    </Button>
                                  )}
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* VIEW 2: 自定义角色与模块权限矩阵                            */}
      {/* ======================================================== */}
      {activeMainTab === "ROLES" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200/80 shadow-2xs">
            <div>
              <h3 className="text-sm font-bold text-slate-900">角色与权限配置</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                自定义业务岗位角色与模块操作权限，支持多角色赋予与权限自动合并
              </p>
            </div>

            {isAdmin && (
              <Button
                variant="primary"
                size="md"
                onClick={handleOpenCreateRole}
                leftIcon={
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                  </svg>
                }
              >
                新建自定义角色
              </Button>
            )}
          </div>

          {/* 角色卡片列表 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((r) => {
              const assignedCount = r.userCount || 0;
              const permissionsCount = r.permissions.length;

              return (
                <div
                  key={r.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 shadow-2xs hover:shadow-sm transition flex flex-col justify-between space-y-4"
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-slate-900">{r.name}</h4>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold border ${
                              r.isSystem
                                ? "bg-slate-100 text-slate-600 border-slate-200"
                                : "bg-indigo-50 text-indigo-700 border-indigo-200"
                            }`}
                          >
                            {r.isSystem ? "系统内置" : "自定义角色"}
                          </span>
                        </div>
                        <code className="text-[10px] text-slate-400 font-mono">{r.code}</code>
                      </div>

                      <span className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full font-mono shrink-0">
                        {assignedCount} 人使用
                      </span>
                    </div>

                    <p className="text-xs text-slate-500 leading-relaxed min-h-[36px]">
                      {r.description || "暂无角色职能描述"}
                    </p>

                    {/* 已授权限摘要 */}
                    <div className="pt-2 border-t border-slate-100">
                      <div className="flex items-center justify-between text-[11px] text-slate-500 mb-1.5">
                        <span>已解锁模块权限:</span>
                        <strong className="text-slate-800 font-mono">{permissionsCount} 项</strong>
                      </div>
                      <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                        {r.permissions.map((pKey) => {
                          const meta = ALL_PERMISSION_DEFINITIONS.find((p) => p.key === pKey);
                          return (
                            <span
                              key={pKey}
                              className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-700 border border-slate-200 font-medium"
                              title={meta?.description}
                            >
                              {meta?.name || pKey}
                            </span>
                          );
                        })}
                        {r.permissions.length === 0 && (
                          <span className="text-[11px] text-slate-400 italic">尚未勾选任何操作权限</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100">
                      {!r.isSystem && (
                        <button
                          type="button"
                          onClick={() => handleDeleteRole(r.id, r.name)}
                          className="px-2.5 py-1 rounded text-xs font-semibold text-rose-600 hover:bg-rose-50 transition"
                        >
                          删除角色
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleOpenEditRole(r)}
                        className="px-3 py-1 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition"
                      >
                        编辑权限勾选
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 弹窗 1：成员新建/编辑与角色多选赋权弹窗                     */}
      {/* ======================================================== */}
      {showMemberModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200/80 space-y-4 my-8">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-950">
                {editingMember ? `编辑成员 - ${editingMember.name}` : "添加新团队成员"}
              </h3>
              <button onClick={() => setShowMemberModal(false)} className="text-slate-400 hover:text-slate-700 text-sm">
                ×
              </button>
            </div>

            <div className="space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">真实姓名 *</label>
                  <input
                    type="text"
                    value={memberForm.name}
                    onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })}
                    placeholder="例如：张子豪"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">企业登录邮箱 *</label>
                  <input
                    type="email"
                    disabled={!!editingMember}
                    value={memberForm.email}
                    onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })}
                    placeholder="name@example.com"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-400 focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">手机号码</label>
                  <input
                    type="text"
                    value={memberForm.phone || ""}
                    onChange={(e) => setMemberForm({ ...memberForm, phone: e.target.value })}
                    placeholder="13800000000"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">员工工号</label>
                  <input
                    type="text"
                    value={memberForm.employeeNo || ""}
                    onChange={(e) => setMemberForm({ ...memberForm, employeeNo: e.target.value })}
                    placeholder="EMP008"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">所属部门</label>
                  <select
                    value={memberForm.departmentId || ""}
                    onChange={(e) => setMemberForm({ ...memberForm, departmentId: e.target.value })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  >
                    <option value="">-- 未分配部门 --</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">岗位职务</label>
                  <input
                    type="text"
                    value={memberForm.jobTitle || ""}
                    onChange={(e) => setMemberForm({ ...memberForm, jobTitle: e.target.value })}
                    placeholder="例如：华东大区销售经理"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">基础系统身份 *</label>
                  <select
                    value={memberForm.role}
                    onChange={(e) => setMemberForm({ ...memberForm, role: e.target.value as Role })}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  >
                    <option value="SALES">销售专员 (SALES)</option>
                    <option value="MANAGER">业务主管 (MANAGER)</option>
                    <option value="ADMIN">超级管理员 (ADMIN)</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">私海客户库容配额 (户)</label>
                  <input
                    type="number"
                    value={memberForm.maxLeadQuota}
                    onChange={(e) => setMemberForm({ ...memberForm, maxLeadQuota: Number(e.target.value) || 50 })}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* 重点：附加自定义角色多选授权 */}
              <div className="pt-2 border-t border-slate-100">
                <label className="block font-semibold text-slate-800 mb-1">
                  附加自定义业务角色 (多角色继承)
                </label>
                <p className="text-[11px] text-slate-500 mb-2">
                  员工可同时拥有多个角色，最终权限为所有角色的并集。
                </p>
                <div className="space-y-1.5 max-h-36 overflow-y-auto p-2 bg-slate-50 rounded-lg border border-slate-200/80">
                  {roles
                    .filter((r) => !r.isSystem)
                    .map((r) => {
                      const isChecked = selectedMemberCustomRoleIds.includes(r.id);
                      return (
                        <label
                          key={r.id}
                          className="flex items-center gap-2 p-1.5 bg-white rounded border border-slate-200 text-xs hover:bg-slate-50 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedMemberCustomRoleIds([...selectedMemberCustomRoleIds, r.id]);
                              } else {
                                setSelectedMemberCustomRoleIds(selectedMemberCustomRoleIds.filter((id) => id !== r.id));
                              }
                            }}
                            className="rounded text-indigo-600 focus:ring-0"
                          />
                          <div className="min-w-0 flex-1">
                            <span className="font-bold text-slate-800">{r.name}</span>
                            <span className="text-[10px] text-slate-400 font-mono ml-1.5">({r.code})</span>
                            {r.description && (
                              <p className="text-[10px] text-slate-500 truncate">{r.description}</p>
                            )}
                          </div>
                        </label>
                      );
                    })}
                  {roles.filter((r) => !r.isSystem).length === 0 && (
                    <p className="text-xs text-slate-400 text-center py-2">
                      暂无自定义角色，可在【自定义角色与权限配置】Tab 中创建
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setShowMemberModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleSaveMember}
                className="px-4 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
              >
                {isPending ? "保存中..." : "保存成员与角色"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ======================================================== */}
      {/* 弹窗 2：自定义角色与模块权限勾选弹窗                          */}
      {/* ======================================================== */}
      {showRoleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200/80 space-y-4 my-8 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3 shrink-0">
              <div>
                <h3 className="text-base font-bold text-slate-950">
                  {editingRole ? `编辑角色权限 - ${editingRole.name}` : "新建自定义业务角色"}
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  勾选该角色允许操作的模块功能与特权
                </p>
              </div>
              <button onClick={() => setShowRoleModal(false)} className="text-slate-400 hover:text-slate-700 text-sm">
                ×
              </button>
            </div>

            <div className="space-y-4 text-xs overflow-y-auto flex-1 pr-1">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">角色名称 *</label>
                  <input
                    type="text"
                    value={roleForm.name}
                    onChange={(e) => setRoleForm({ ...roleForm, name: e.target.value })}
                    placeholder="例如：商业化产品运营经理"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">角色标识编码 (唯一) *</label>
                  <input
                    type="text"
                    disabled={!!editingRole}
                    value={roleForm.code}
                    onChange={(e) => setRoleForm({ ...roleForm, code: e.target.value.toUpperCase() })}
                    placeholder="例如：PRODUCT_OPS"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs disabled:bg-slate-50 disabled:text-slate-400 font-mono focus:border-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">角色职能描述</label>
                <input
                  type="text"
                  value={roleForm.description}
                  onChange={(e) => setRoleForm({ ...roleForm, description: e.target.value })}
                  placeholder="说明该角色的主要职责与业务场景..."
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                />
              </div>

              {/* 核心：模块权限多选勾选面板 */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <label className="block font-bold text-slate-900">
                    模块功能操作权限勾选 (Modular Permissions)
                  </label>
                  <span className="text-[11px] text-indigo-600 font-bold font-mono">
                    已选 {roleForm.permissions.length} 项
                  </span>
                </div>

                <div className="space-y-3">
                  {permissionCategories.map(([categoryKey, items]) => {
                    const catMeta = PERMISSION_CATEGORY_NAMES[categoryKey as keyof typeof PERMISSION_CATEGORY_NAMES];
                    const catKeys = items.map((i) => i.key);
                    const allSelected = catKeys.every((k) => roleForm.permissions.includes(k));

                    return (
                      <div key={categoryKey} className="rounded-xl border border-slate-200 bg-slate-50/40 overflow-hidden">
                        <div className="px-3.5 py-2 bg-slate-100/80 border-b border-slate-200 flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`px-2 py-0.2 rounded text-[10px] font-bold border ${catMeta?.color || "text-slate-700 bg-slate-50 border-slate-200"}`}>
                              {catMeta?.tag || categoryKey}
                            </span>
                            <span className="font-bold text-slate-800 text-xs">
                              {catMeta?.name || categoryKey}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleCategoryPermissions(categoryKey, allSelected)}
                            className="text-[11px] text-blue-600 hover:text-blue-800 font-semibold"
                          >
                            {allSelected ? "取消全选" : "全选本组"}
                          </button>
                        </div>

                        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2 bg-white">
                          {items.map((p) => {
                            const isChecked = roleForm.permissions.includes(p.key);
                            return (
                              <label
                                key={p.key}
                                className={`flex items-start gap-2.5 p-2 rounded-lg border transition cursor-pointer ${
                                  isChecked
                                    ? "bg-indigo-50/50 border-indigo-200"
                                    : "bg-white border-slate-200/80 hover:bg-slate-50"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleRolePermission(p.key)}
                                  className="mt-0.5 rounded text-indigo-600 focus:ring-0"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="font-bold text-slate-900 text-[11.5px] leading-tight">
                                    {p.name}
                                  </p>
                                  <p className="text-[10.5px] text-slate-500 mt-0.5 leading-relaxed">
                                    {p.description}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowRoleModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleSaveRole}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isPending ? "保存中..." : "保存角色与权限"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗 4：部门新建/编辑弹窗 */}
      {showDeptModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl border border-slate-200/80 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-950">
                {editingDept ? "编辑部门" : "新建组织部门"}
              </h3>
              <button onClick={() => setShowDeptModal(false)} className="text-slate-400 hover:text-slate-700 text-sm">
                ×
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">部门名称 *</label>
                <input
                  type="text"
                  value={deptName}
                  onChange={(e) => setDeptName(e.target.value)}
                  placeholder="例如：华东销售一部"
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs focus:border-slate-900 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">部门负责人 / 主管</label>
                <select
                  value={deptLeaderId}
                  onChange={(e) => setDeptLeaderId(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:border-slate-900 focus:outline-none"
                >
                  <option value="">-- 请选择主管负责人 --</option>
                  {members
                    .filter((m) => m.status === "ACTIVE")
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.role})
                      </option>
                    ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              {editingDept ? (
                <button
                  type="button"
                  onClick={() => handleDeleteDept(editingDept.id)}
                  className="text-red-600 hover:text-red-700 text-xs font-semibold"
                >
                  删除部门
                </button>
              ) : (
                <span />
              )}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDeptModal(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  disabled={isPending}
                  onClick={handleSaveDept}
                  className="px-4 py-1.5 rounded-lg bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  {isPending ? "保存中..." : "保存部门"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 弹窗 5：企业通讯录自动同步控制台 */}
      {showDirectorySyncModal && (
        <WorkplaceDirectorySyncModal
          initialConfigs={directoryConfigs}
          onClose={() => setShowDirectorySyncModal(false)}
          onSyncComplete={async () => {
            const res = await listTeamMembersAction();
            if (res.ok) setMembers(res.data);
            notify("通讯录同步成功，成员花名册已更新");
          }}
        />
      )}

      {/* 弹窗 6：离职交接向导 */}
      {showOffboardModal && offboardTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-2xl border border-slate-200/80 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-950">
                员工离职资产交接 - {offboardTarget.name}
              </h3>
              <button onClick={() => setShowOffboardModal(false)} className="text-slate-400 hover:text-slate-700 text-sm">
                ×
              </button>
            </div>

            <div className="space-y-3 text-xs">
              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-800 text-[11.5px]">
                <p>
                  待交接线索: <strong>{offboardSummary?.leadsCount || 0}</strong> 条，
                  关联客户: <strong>{offboardSummary?.customersCount || 0}</strong> 户，
                  推进中商机: <strong>{offboardSummary?.dealsCount || 0}</strong> 个
                </p>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">资产交接策略</label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="strategy"
                      checked={transferStrategy === "TRANSFER"}
                      onChange={() => setTransferStrategy("TRANSFER")}
                    />
                    <span>转移给指定同事</span>
                  </label>
                  <label className="flex items-center gap-2 p-2 border rounded-lg cursor-pointer hover:bg-slate-50">
                    <input
                      type="radio"
                      name="strategy"
                      checked={transferStrategy === "RETURN_TO_POOL"}
                      onChange={() => setTransferStrategy("RETURN_TO_POOL")}
                    />
                    <span>退回公共公海池</span>
                  </label>
                </div>
              </div>

              {transferStrategy === "TRANSFER" && (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">选择资产接手人 *</label>
                  <select
                    value={transferToUserId}
                    onChange={(e) => setTransferToUserId(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs focus:border-slate-900 focus:outline-none"
                  >
                    <option value="">-- 请选择接手同事 --</option>
                    {members
                      .filter((m) => m.id !== offboardTarget.id && m.status === "ACTIVE")
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.departmentName || "未分配"} - {m.jobTitle || "顾问"})
                        </option>
                      ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={() => setShowOffboardModal(false)}
                className="px-3.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={handleExecuteOffboard}
                className="px-4 py-1.5 rounded-lg bg-rose-600 text-xs font-semibold text-white hover:bg-rose-700 disabled:opacity-50"
              >
                {isPending ? "处理中..." : "确认交接并注销"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
