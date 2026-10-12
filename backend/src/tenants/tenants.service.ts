import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { CurrentUser } from '../auth/current-user';
import {
  MEMBER_ROLE_ADMIN,
  MEMBER_ROLE_USER,
  ROLE_ADMIN,
  ROLE_USER,
} from '../auth/current-user';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { text } from '../common/api';

/** 租户编码：小写字母数字与 - _，用于对账与检索，创建后不改。 */
const TENANT_CODE_RE = /^[a-z0-9_-]{2,32}$/;

/**
 * 租户（Tenant）= 平台交付给 B 端客户的独立工作区。
 * 分工按用户定的口径：系统管理员管理租户（开通、启停、额度池、成员），
 * 租户管理员管理自己租户内的成员（建号、拉人加入、启停、发额度、设定租户内权限）。
 * 一个账号可以同时是多个租户的成员，额度与用量按租户各记一份。
 */
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  tenantView(tenant: {
    id: number;
    name: string;
    code: string;
    contact: string;
    status: number;
    quotaPool: number;
    usedQuota: number;
    expiresAt: number;
    remark: string;
    createdAt: Date;
  }) {
    return {
      id: tenant.id,
      name: tenant.name,
      code: tenant.code,
      contact: tenant.contact,
      status: tenant.status,
      quotaPool: tenant.quotaPool,
      usedQuota: tenant.usedQuota,
      expiresAt: tenant.expiresAt,
      remark: tenant.remark,
      createdAt: tenant.createdAt,
    };
  }

  // ---------- 平台侧：系统管理员 → 租户 ----------

  async list(
    page: number,
    pageSize: number,
    offset: number,
    filters: { keyword?: string; status?: string },
  ) {
    const keyword = (filters.keyword || '').trim();
    const where = {
      ...(filters.status ? { status: Number(filters.status) } : {}),
      ...(keyword
        ? {
            OR: [
              { name: { contains: keyword } },
              { code: { contains: keyword } },
              { contact: { contains: keyword } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.tenant.findMany({
        where,
        include: { _count: { select: { members: true } } },
        orderBy: { id: 'asc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.tenant.count({ where }),
    ]);
    return {
      list: rows.map((row) => ({
        ...this.tenantView(row),
        memberCount: row._count.members,
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 下拉选项：管理侧按租户筛订单/账号时只需要 id + name + code（含已停用租户）。 */
  async options() {
    return this.prisma.tenant.findMany({
      orderBy: { id: 'asc' },
      take: 500,
      select: { id: true, name: true, code: true },
    });
  }

  async create(input: {
    name: string;
    code: string;
    contact?: string;
    remark?: string;
  }) {
    const name = text(input.name).trim();
    const code = text(input.code).trim().toLowerCase();
    if (!name) {
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '租户名称必填');
    }
    if (!TENANT_CODE_RE.test(code)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '租户编码需为 2-32 位小写字母、数字或 - _',
      );
    }
    const exists = await this.prisma.tenant.findUnique({ where: { code } });
    if (exists) {
      throw new BusinessException(ErrorCode.CONFLICT, '租户编码已存在');
    }
    const tenant = await this.prisma.tenant.create({
      data: {
        name,
        code,
        contact: text(input.contact).trim(),
        remark: text(input.remark).trim(),
      },
    });
    return this.tenantView(tenant);
  }

  async update(
    id: number,
    input: { name?: string; contact?: string; remark?: string },
  ) {
    const tenant = await this.mustGet(id);
    const name = input.name === undefined ? undefined : text(input.name).trim();
    if (name !== undefined && !name) {
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '租户名称必填');
    }
    const updated = await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        name: name ?? tenant.name,
        contact:
          input.contact === undefined
            ? tenant.contact
            : text(input.contact).trim(),
        remark:
          input.remark === undefined ? tenant.remark : text(input.remark).trim(),
      },
    });
    return this.tenantView(updated);
  }

  async setStatus(id: number, status: number) {
    const tenant = await this.mustGet(id);
    const updated = await this.prisma.tenant.update({
      where: { id: tenant.id },
      data: { status: status === 1 ? 1 : 0 },
    });
    return this.tenantView(updated);
  }

  /**
   * 额度池划拨 / 回收：正数入账，负数只能收到 0 为止。
   * updateMany 带条件保证并发下不会把余量扣成负数。
   */
  async adjustPool(
    operatorUid: number,
    id: number,
    delta: number,
    note: string,
    type = delta > 0 ? 'ALLOCATE' : 'DEDUCT',
  ) {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '额度变动值必须为非 0 整数',
      );
    }
    const updated = await this.prisma.tenant.updateMany({
      where: { id, ...(delta < 0 ? { quotaPool: { gte: -delta } } : {}) },
      data: { quotaPool: { increment: delta } },
    });
    if (updated.count !== 1) {
      const tenant = await this.mustGet(id);
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `额度池余量不足，当前可分配 ${tenant.quotaPool}`,
      );
    }
    const fresh = await this.prisma.tenant.findUnique({ where: { id } });
    const txn = await this.prisma.tenantQuotaTxn.create({
      data: {
        tenantId: id,
        delta,
        quotaAfter: fresh?.quotaPool ?? 0,
        operatorId: operatorUid,
        note: text(note).trim() || type,
      },
    });
    return {
      delta,
      quotaPool: fresh?.quotaPool ?? 0,
      note: txn.note,
      createdAt: txn.createdAt,
    };
  }

  async poolTxns(
    id: number,
    page: number,
    pageSize: number,
    offset: number,
  ) {
    const [list, total] = await Promise.all([
      this.prisma.tenantQuotaTxn.findMany({
        where: { tenantId: id },
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.tenantQuotaTxn.count({ where: { tenantId: id } }),
    ]);
    return { list, total, page, pageSize };
  }

  /** 租户详情：本体 + 成员数 + 生效中的软件权益（订单列表走 /admin/orders?tenantId=）。 */
  async detail(id: number) {
    const tenant = await this.mustGet(id);
    const [memberCount, entitlements] = await Promise.all([
      this.prisma.tenantMember.count({ where: { tenantId: tenant.id } }),
      this.entitlements(tenant.id),
    ]);
    return {
      ...this.tenantView(tenant),
      memberCount,
      entitlements,
    };
  }

  /** 租户的软件权益（订阅到期 / 功能买断），平台与租户两侧共用同一份口径。 */
  async entitlements(tenantId: number) {
    const now = Math.floor(Date.now() / 1000);
    const rows = await this.prisma.tenantEntitlement.findMany({
      where: { tenantId },
      orderBy: { id: 'desc' },
      take: 200,
    });
    return rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      name: row.name,
      kind: row.kind,
      expiresAt: row.expiresAt,
      enabled: row.enabled,
      createdAt: row.createdAt,
      active: row.enabled === 1 && (row.expiresAt === 0 || row.expiresAt > now),
    }));
  }

  /** 平台侧下钻某租户的成员：与「账号管理」同一套视图，按租户筛后带租户内额度与角色。 */
  async membersOfTenant(
    tenantId: number,
    page: number,
    pageSize: number,
    offset: number,
    keyword: string,
  ) {
    await this.mustGet(tenantId);
    return this.users.listUsers(page, pageSize, offset, keyword, tenantId);
  }

  /** 平台侧为租户建一个账号并直接设为租户管理员（登录后在前台侧栏看到「本租户管理」）。 */
  async createTenantAdmin(
    operator: { role: number },
    tenantId: number,
    input: { username: string; password: string; displayName?: string },
  ) {
    await this.assertTenantJoinable(tenantId);
    return this.users.adminCreate(operator, {
      username: input.username,
      password: input.password,
      displayName: input.displayName,
      role: ROLE_USER,
      tenantId,
      memberRole: MEMBER_ROLE_ADMIN,
    });
  }

  /** 平台侧把已有账号加入租户（一个账号可以同属多个租户）。 */
  async addMemberToTenant(
    tenantId: number,
    input: { username: string; memberRole?: number; quota?: number },
  ) {
    const tenant = await this.assertTenantJoinable(tenantId);
    const memberRole = this.normalizeMemberRole(input.memberRole);
    const account = await this.prisma.user.findUnique({
      where: { username: text(input.username).trim() },
    });
    if (!account) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '没有这个账号，请先在「账号管理」创建',
      );
    }
    await this.attachMember(tenant.id, account.id, memberRole);
    const quota = Math.max(0, Math.trunc(Number(input.quota ?? 0)));
    if (quota > 0) {
      // 平台侧直接给的额度不占用租户额度池（与「账号管理」里的额度处置同一口径）
      await this.users.grantQuota(
        account.id,
        tenant.id,
        quota,
        'TOPUP',
        account.id,
        '平台加入租户并授予额度',
      );
    }
    return { tenantId: tenant.id, userId: account.id, memberRole, quota };
  }

  /** 平台侧设定成员在该租户内的权限（成员 / 管理员）与启停。 */
  async setMemberRole(
    tenantId: number,
    uid: number,
    memberRole: number,
  ) {
    const role = this.normalizeMemberRole(memberRole);
    const membership = await this.mustMember(tenantId, uid);
    await this.prisma.tenantMember.update({
      where: { id: membership.id },
      data: { role },
    });
    return { tenantId, userId: uid, memberRole: role };
  }

  async setMemberStatus(
    tenantId: number,
    uid: number,
    status: number,
  ) {
    const membership = await this.mustMember(tenantId, uid);
    await this.prisma.tenantMember.update({
      where: { id: membership.id },
      data: { status: status === 1 ? 1 : 0 },
    });
    return { tenantId, userId: uid, status: status === 1 ? 1 : 0 };
  }

  // ---------- 租户侧：租户管理员 → 本租户成员 ----------

  /**
   * 租户侧入口统一收口：身份从会话里的「当前租户 + 该租户内角色」推出，
   * 接口不接受前端传 tenantId，切换租户后管理范围跟着换。
   */
  async requireTenant(user: CurrentUser) {
    if (!user.tenantId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '当前账号还没有加入任何租户，请先创建或加入一个租户',
      );
    }
    if (user.memberRole !== MEMBER_ROLE_ADMIN) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '本租户管理（用户管理 / 模型使用记录）仅该租户的管理员可访问',
      );
    }
    return this.mustGet(user.tenantId);
  }

  /** 下单身份：软件是卖给租户的，所以只有启用中租户的租户管理员能订购。 */
  async purchaserTenant(user: CurrentUser) {
    const tenant = await this.requireTenant(user);
    if (tenant.status !== 1) {
      throw new BusinessException(ErrorCode.ORDER_STATE, '租户已停用，无法订购');
    }
    return tenant;
  }

  async consoleOverview(user: CurrentUser) {
    const tenant = await this.requireTenant(user);
    const where = { tenantId: tenant.id };
    const [memberCount, adminCount, sums, entitlements] = await Promise.all([
      this.prisma.tenantMember.count({ where }),
      this.prisma.tenantMember.count({ where: { ...where, role: MEMBER_ROLE_ADMIN } }),
      this.prisma.tenantMember.aggregate({
        where,
        _sum: { quota: true, usedQuota: true },
      }),
      this.entitlements(tenant.id),
    ]);
    return {
      ...this.tenantView(tenant),
      memberCount,
      adminCount,
      allocatedQuota: sums._sum.quota || 0,
      consumedQuota: sums._sum.usedQuota || 0,
      entitlements,
    };
  }

  /** 本租户成员列表：租户由会话推出，前端传什么都不影响收口范围。 */
  async consoleUsers(
    user: CurrentUser,
    page: number,
    pageSize: number,
    offset: number,
    keyword: string,
  ) {
    const tenant = await this.requireTenant(user);
    return this.users.listUsers(page, pageSize, offset, keyword, tenant.id);
  }

  /** 租户建号：新建一个全局普通账号，并作为本租户成员入驻。 */
  async consoleCreateUser(
    user: CurrentUser,
    input: {
      username: string;
      password: string;
      displayName?: string;
      memberRole?: number;
      quota?: number;
    },
  ) {
    const tenant = await this.requireTenant(user);
    const memberRole = this.normalizeMemberRole(input.memberRole);
    const created = await this.users.adminCreate(
      { role: user.role },
      {
        username: input.username,
        password: input.password,
        displayName: input.displayName,
        role: ROLE_USER,
        tenantId: tenant.id,
        memberRole,
      },
    );
    const quota = Math.max(0, Math.trunc(Number(input.quota ?? 0)));
    if (quota > 0) {
      await this.transferQuota(
        tenant.id,
        user.uid,
        Number(created.id),
        quota,
        '建号初始额度',
      );
      // 建号时的额度是随后从本租户池划的，返回值要重取，否则界面看到的还是 0
      return this.users.view(Number(created.id), tenant.id);
    }
    return created;
  }

  /** 租户拉人：把已有账号加进本租户（对方切租户即可使用本租户划的额度）。 */
  async consoleAddMember(
    user: CurrentUser,
    input: { username: string; memberRole?: number; quota?: number },
  ) {
    const tenant = await this.requireTenant(user);
    // 额度只走下面 transferQuota 这一条路（从本租户额度池出），这里不能顺手发一遍
    const result = await this.addMemberToTenant(tenant.id, {
      username: input.username,
      memberRole: input.memberRole,
    });
    const quota = Math.max(0, Math.trunc(Number(input.quota ?? 0)));
    if (quota > 0) {
      // 租户发的额度必须从本租户额度池出，池子不够就整笔失败
      await this.transferQuota(
        tenant.id,
        user.uid,
        result.userId,
        quota,
        '加入本租户并发放额度',
      );
    }
    return result;
  }

  /** 成员处置：租户内权限与启停记在成员身份上，姓名/邮箱/密码记在账号上。 */
  async consoleSetMember(
    user: CurrentUser,
    uid: number,
    input: {
      status?: number;
      memberRole?: number;
      displayName?: string;
      email?: string;
    },
  ) {
    const tenant = await this.requireTenant(user);
    const membership = await this.mustManagedMember(tenant.id, uid);
    if (input.memberRole !== undefined) {
      await this.setMemberRole(tenant.id, uid, input.memberRole);
    }
    if (input.status !== undefined) {
      await this.setMemberStatus(tenant.id, uid, input.status);
    }
    if (input.displayName !== undefined || input.email !== undefined) {
      await this.users.adminUpdate(
        { uid: user.uid, role: user.role },
        uid,
        { displayName: input.displayName, email: input.email },
      );
    }
    return {
      tenantId: tenant.id,
      userId: uid,
      memberRole: input.memberRole ?? membership.role,
      status: input.status ?? membership.status,
    };
  }

  async consoleSetUserPassword(
    user: CurrentUser,
    uid: number,
    password: string,
  ) {
    const tenant = await this.requireTenant(user);
    await this.mustManagedMember(tenant.id, uid);
    return this.users.adminUpdate({ uid: user.uid, role: user.role }, uid, {
      password,
    });
  }

  /**
   * 额度在「租户额度池」与「租户成员」之间转移：
   * delta>0 从池里发给成员，delta<0 从成员收回池里；两边都留流水。
   */
  async transferQuota(
    tenantId: number,
    operatorUid: number,
    uid: number,
    delta: number,
    note: string,
  ) {
    if (!Number.isInteger(delta) || delta === 0) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '额度变动值必须为非 0 整数',
      );
    }
    const membership = await this.mustMember(tenantId, uid);
    const applied =
      delta > 0 ? delta : -Math.min(-delta, Math.max(0, membership.quota));
    if (applied === 0) {
      throw new BusinessException(ErrorCode.CONFLICT, '该成员没有可回收的额度');
    }
    await this.adjustPool(
      operatorUid,
      tenantId,
      -applied,
      note || (applied > 0 ? '分配给租户成员' : '从租户成员回收'),
      applied > 0 ? 'ALLOCATE' : 'RECLAIM',
    );
    await this.users.grantQuota(
      uid,
      tenantId,
      applied,
      applied > 0 ? 'ALLOCATE' : 'DEDUCT',
      operatorUid,
      note || (applied > 0 ? '租户分配额度' : '租户回收额度'),
    );
    return { delta: applied };
  }

  // ---------- 支付履约：订单到账进租户（额度池 / 软件权益） ----------

  /** 订购额度包：到账进额度池，租户再自行分配给自家成员。 */
  async grantPool(
    tenantId: number,
    delta: number,
    note: string,
    operatorId = 0,
  ) {
    return this.adjustPool(operatorId, tenantId, delta, note, 'TOPUP');
  }

  /** 订阅/功能买断履约：写租户权益，订阅同时刷新租户到期时间。 */
  async grantEntitlement(params: {
    tenantId: number;
    productId: string;
    name: string;
    kind: 'subscription' | 'feature';
    expiresAt: number;
  }) {
    await this.prisma.tenantEntitlement.upsert({
      where: {
        tenantId_productId: {
          tenantId: params.tenantId,
          productId: params.productId,
        },
      },
      create: {
        tenantId: params.tenantId,
        productId: params.productId,
        name: params.name,
        kind: params.kind,
        expiresAt: params.expiresAt,
      },
      update: {
        enabled: 1,
        kind: params.kind,
        name: params.name,
        expiresAt: params.expiresAt,
      },
    });
    if (params.kind === 'subscription' && params.expiresAt > 0) {
      // 续订叠加在已有到期之后：只把到期时间往后推，不回退
      await this.prisma.tenant.updateMany({
        where: { id: params.tenantId, expiresAt: { lt: params.expiresAt } },
        data: { expiresAt: params.expiresAt },
      });
    }
  }

  async revokeEntitlement(tenantId: number, productId: string) {
    await this.prisma.tenantEntitlement.updateMany({
      where: { tenantId, productId },
      data: { enabled: 0 },
    });
  }

  /**
   * 模型使用记录：本租户成员（含租户管理员自己）的调用与额度流水。
   * 日志上的 tenantId 由会话推出，前端传任何 userId 都只在本租户范围内生效；
   * 渠道 / 令牌被删后日志仍保留当时的归属快照，所以这里可追溯。
   * 返回前去掉渠道归属与计费快照：上游渠道、批发价与毛利是平台侧口径（`other` 里有 wholesale_cny / profit_cny），不给租户看。
   */
  async consoleLogs(
    user: CurrentUser,
    page: number,
    pageSize: number,
    offset: number,
    filter: { userId?: number; keyword: string; type?: number },
  ) {
    const tenant = await this.requireTenant(user);
    const where = {
      tenantId: tenant.id,
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.type === undefined ? {} : { type: filter.type }),
      ...(filter.keyword
        ? {
            OR: [
              { modelName: { contains: filter.keyword } },
              { tokenName: { contains: filter.keyword } },
              { username: { contains: filter.keyword } },
            ],
          }
        : {}),
    };
    const [rows, total, sums] = await Promise.all([
      this.prisma.log.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.log.count({ where }),
      this.prisma.log.aggregate({ where, _sum: { quota: true } }),
    ]);
    return {
      list: rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        tenantId: row.tenantId,
        type: row.type,
        content: row.content,
        username: row.username,
        tokenName: row.tokenName,
        modelName: row.modelName,
        quota: row.quota,
        promptTokens: row.promptTokens,
        completionTokens: row.completionTokens,
        useTime: row.useTime,
        isStream: row.isStream,
        group: row.group,
        ip: row.ip,
        requestId: row.requestId,
        createdAt: row.createdAt,
      })),
      total,
      page,
      pageSize,
      quota: sums._sum.quota || 0,
    };
  }

  // ---------- 内部 ----------

  private async mustGet(id: number) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: Number(id) },
    });
    if (!tenant) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '租户不存在');
    }
    return tenant;
  }

  private async assertTenantJoinable(id: number) {
    const tenant = await this.mustGet(id);
    if (tenant.status !== 1) {
      throw new BusinessException(ErrorCode.CONFLICT, '租户已停用，不能添加成员');
    }
    return tenant;
  }

  private normalizeMemberRole(value: unknown): number {
    const role = Number(value ?? MEMBER_ROLE_USER);
    if (![MEMBER_ROLE_USER, MEMBER_ROLE_ADMIN].includes(role)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '租户内权限只有「成员」和「管理员」两档',
      );
    }
    return role;
  }

  private async mustMember(tenantId: number, uid: number) {
    const membership = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId: Number(uid) } },
    });
    if (!membership) {
      throw new BusinessException(ErrorCode.NOT_FOUND, '该账号不是本租户的成员');
    }
    return membership;
  }

  /**
   * 租户管理员可处置的成员范围：平台管理员/超管是平台的人，租户不能停用他们、
   * 也不能改他们的密码；不同租户的成员一律 404，避免用别人的成员关系试出账号存在性。
   */
  private async mustManagedMember(tenantId: number, uid: number) {
    const membership = await this.mustMember(tenantId, uid);
    const account = await this.prisma.user.findUnique({
      where: { id: membership.userId },
    });
    if (!account || account.role >= ROLE_ADMIN) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '无权处置平台管理员账号');
    }
    return membership;
  }

  /** 建成员：唯一约束兜底「同一租户同一账号只能有一条成员关系」。 */
  private async attachMember(
    tenantId: number,
    userId: number,
    memberRole: number,
  ) {
    const existing = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
    });
    if (existing) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该账号已经是本租户的成员',
      );
    }
    return this.prisma.tenantMember.create({
      data: {
        tenantId,
        userId,
        role: memberRole,
        joinedAt: Math.floor(Date.now() / 1000),
      },
    });
  }
}
