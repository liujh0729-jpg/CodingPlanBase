/**
 * 身份分两个轴，不能混为一谈：
 * - 全局身份（`user.role`）：0 保留 / 1 普通用户 / 10 系统管理员 / 100 超级管理员（编号镜像 newapi Role 常量）。
 * - 租户内角色（`tenant_members.role`）：1 成员 / 5 租户管理员；同一个人可以在 A 租户当管理员、在 B 租户只是成员。
 * 「租户管理员」不是全局身份，所以它只出现在 memberRole 上，不出现在 role 上。
 */
export const ROLE_GUEST = 0;
export const ROLE_USER = 1;
export const ROLE_ADMIN = 10;
export const ROLE_ROOT = 100;

export const MEMBER_ROLE_USER = 1;
export const MEMBER_ROLE_ADMIN = 5;

export class CurrentUser {
  constructor(
    readonly uid: number,
    readonly username: string,
    readonly role: number,
    /** 本次会话的当前租户；null = 不在任何租户内（平台侧视角，或还没创建/加入租户）。 */
    readonly tenantId: number | null = null,
    /** 在 `tenantId` 这个租户里的角色；0 = 没有当前租户。 */
    readonly memberRole: number = 0,
  ) {}

  isAdmin(): boolean {
    return this.role >= ROLE_ADMIN;
  }

  isRoot(): boolean {
    return this.role >= ROLE_ROOT;
  }

  /** 租户管理菜单（用户管理 / 模型使用记录 / 对平台订购）的门槛：当前租户内的角色 5。 */
  isTenantAdmin(): boolean {
    return this.tenantId !== null && this.memberRole === MEMBER_ROLE_ADMIN;
  }
}
