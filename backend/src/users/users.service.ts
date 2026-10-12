import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  MEMBER_ROLE_ADMIN,
  MEMBER_ROLE_USER,
  ROLE_ADMIN,
  ROLE_ROOT,
  ROLE_USER,
} from '../auth/current-user';
import { pickActiveMembership } from '../auth/identity';
import { hashPassword, verifyPassword } from '../auth/password';
import { signAccessToken, signRefreshToken, verifyToken } from '../auth/jwt';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { text } from '../common/api';

const USERNAME_RE = /^[a-zA-Z0-9_@.-]{3,20}$/;
/** 租户编码：与「租户管理」同一套规则，注册引导里输入它即可加入该租户。 */
const TENANT_CODE_RE = /^[a-z0-9_-]{2,32}$/;

type UserRow = Prisma.UserGetPayload<object>;
type MembershipRow = Prisma.TenantMemberGetPayload<{
  include: { tenant: true };
}>;
type MemberSummary = Prisma.TenantMemberGetPayload<{
  include: { tenant: { select: { id: true; name: true; code: true } } };
}>;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  user: ReturnType<UsersService['toView']>;
}

/**
 * 身份有两个轴：`user.role` 是全局身份（普通用户 / 系统管理员 / 超级管理员），
 * `tenant_members.role` 是某个租户内的角色（成员 / 租户管理员）。
 * 额度、用量、令牌、日志都挂在成员身份上，所以「切租户」＝换一个记账上下文。
 */
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  /** 会话视图：全局身份 + 当前租户里的成员身份 + 我所属的全部租户。 */
  toView(
    user: UserRow,
    memberships: MembershipRow[],
    active: MembershipRow | null,
  ) {
    return {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      status: user.status,
      email: user.email,
      userGroup: user.userGroup,
      affCode: user.affCode,
      chandlerLinked: Boolean(user.chandlerSub),
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      // 当前租户（记账上下文）
      tenantId: active?.tenantId ?? null,
      tenantName: active?.tenant.name ?? '',
      tenantCode: active?.tenant.code ?? '',
      tenantStatus: active?.tenant.status ?? 0,
      memberRole: active?.role ?? 0,
      quota: active?.quota ?? 0,
      usedQuota: active?.usedQuota ?? 0,
      requestCount: active?.requestCount ?? 0,
      tenantCount: memberships.length,
      tenants: memberships.map((row) => ({
        id: row.tenantId,
        name: row.tenant.name,
        code: row.tenant.code,
        status: row.tenant.status,
        memberRole: row.role,
        memberStatus: row.status,
        quota: row.quota,
        usedQuota: row.usedQuota,
        requestCount: row.requestCount,
        joinedAt: row.joinedAt,
      })),
    };
  }

  private async membershipsWithTenant(uid: number): Promise<MembershipRow[]> {
    return this.prisma.tenantMember.findMany({
      where: { userId: uid },
      include: { tenant: true },
      orderBy: { tenantId: 'asc' },
    });
  }

  private async userOrThrow(uid: number): Promise<UserRow> {
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在');
    return user;
  }

  /** 会话视图的取数入口：hint 来自令牌，成员关系失效时自动退到可用租户。 */
  async view(uid: number, hint: number | null) {
    const [user, memberships] = await Promise.all([
      this.userOrThrow(uid),
      this.membershipsWithTenant(uid),
    ]);
    return this.toView(user, memberships, pickActiveMembership(memberships, hint));
  }

  async me(user: { uid: number; tenantId: number | null }) {
    return this.view(user.uid, user.tenantId ?? null);
  }

  // ---------- 注册 / 登录 / 会话 ----------

  /**
   * 注册后先落到「引导」态：没有任何成员身份时 tenantId 为 null，
   * 前端据此要求创建或加入租户；带 tenantMode 时一步完成，不留半截状态。
   */
  async register(
    username: string,
    password: string,
    displayName = '',
    tenant?: { mode?: 'create' | 'join'; name?: string; code?: string },
  ): Promise<SessionTokens> {
    if (!(await this.settings.getBool('allow_registration'))) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '系统当前不允许自助注册',
      );
    }
    this.assertCredentials(username, password);
    const exists = await this.prisma.user.findUnique({ where: { username } });
    if (exists) {
      throw new BusinessException(ErrorCode.CONFLICT, '用户名已存在');
    }
    const user = await this.prisma.user.create({
      data: {
        username,
        passwordHash: await hashPassword(password),
        displayName: displayName || username,
        role: ROLE_USER,
        affCode: this.randomAffCode(),
      },
    });
    let activeTenantId: number | null = null;
    if (tenant?.mode === 'create') {
      activeTenantId = (await this.createTenantFor(
        user.id,
        tenant.name || `${username}的工作区`,
        tenant.code || this.suggestedCode(username),
      )).tenantId;
    } else if (tenant?.mode === 'join') {
      activeTenantId = (await this.joinTenantFor(user.id, tenant.code || '')).tenantId;
    }
    return this.issueSession(user.id, activeTenantId);
  }

  async login(username: string, password: string): Promise<SessionTokens> {
    const user = await this.prisma.user.findUnique({ where: { username } });
    if (
      !user ||
      user.status !== 1 ||
      !(await verifyPassword(password, user.passwordHash))
    ) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '用户名或密码错误');
    }
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: Math.floor(Date.now() / 1000) },
    });
    return this.issueSession(user.id, null);
  }

  async refresh(refreshToken: string): Promise<SessionTokens> {
    const payload = verifyToken(refreshToken, 'refresh');
    const user = await this.prisma.user.findUnique({
      where: { id: payload.uid },
    });
    if (!user || user.status !== 1) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '账号不可用');
    }
    return this.issueSession(user.id, payload.tenantId || null);
  }

  /** 签发会话：当前租户写进令牌，切租户必须换令牌，否则前端状态和服务端记账会分叉。 */
  private async issueSession(
    uid: number,
    hint: number | null,
  ): Promise<SessionTokens> {
    const [user, memberships] = await Promise.all([
      this.userOrThrow(uid),
      this.membershipsWithTenant(uid),
    ]);
    const active = pickActiveMembership(memberships, hint);
    const claims = {
      uid: user.id,
      username: user.username,
      role: user.role,
      tenantId: active?.tenantId ?? 0,
    };
    return {
      accessToken: signAccessToken(claims),
      refreshToken: signRefreshToken(claims),
      user: this.toView(user, memberships, active),
    };
  }

  // ---------- 租户：创建 / 加入 / 切换 ----------

  /** 注册引导第一步：自建租户，创建者是该租户的管理员（成员角色 5）。 */
  async createTenantFor(
    uid: number,
    rawName: string,
    rawCode: string,
  ): Promise<{ tenantId: number; name: string; code: string }> {
    const name = text(rawName).trim();
    const code = text(rawCode).trim().toLowerCase();
    if (!name) {
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '租户名称必填');
    }
    if (!TENANT_CODE_RE.test(code)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '租户编码需为 2-32 位小写字母、数字或 - _',
      );
    }
    if (await this.prisma.tenant.findUnique({ where: { code } })) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '租户编码已被占用，换一个再试',
      );
    }
    const tenant = await this.prisma.tenant.create({
      data: { name, code, contact: '' },
    });
    await this.prisma.tenantMember.create({
      data: {
        tenantId: tenant.id,
        userId: uid,
        role: MEMBER_ROLE_ADMIN,
        joinedAt: Math.floor(Date.now() / 1000),
      },
    });
    await this.grantWelcomeQuota(uid, tenant.id);
    return { tenantId: tenant.id, name: tenant.name, code: tenant.code };
  }

  /** 注册引导第二步：按租户编码直接加入，成为该租户的普通成员。 */
  async joinTenantFor(
    uid: number,
    rawCode: string,
  ): Promise<{ tenantId: number; name: string; code: string }> {
    const code = text(rawCode).trim().toLowerCase();
    if (!TENANT_CODE_RE.test(code)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '请输入正确的租户编码（2-32 位小写字母、数字或 - _）',
      );
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { code } });
    if (!tenant) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '没有这个租户编码，请向管理员确认后再试',
      );
    }
    if (tenant.status !== 1) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `租户「${tenant.name}」已被平台停用，暂时不能加入`,
      );
    }
    const existing = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId: tenant.id, userId: uid } },
    });
    if (existing) {
      if (existing.status !== 1) {
        throw new BusinessException(
          ErrorCode.FORBIDDEN,
          `你已被租户「${tenant.name}」停用，请联系该租户管理员`,
        );
      }
      return { tenantId: tenant.id, name: tenant.name, code: tenant.code };
    }
    await this.prisma.tenantMember.create({
      data: {
        tenantId: tenant.id,
        userId: uid,
        role: MEMBER_ROLE_USER,
        joinedAt: Math.floor(Date.now() / 1000),
      },
    });
    await this.grantWelcomeQuota(uid, tenant.id);
    return { tenantId: tenant.id, name: tenant.name, code: tenant.code };
  }

  /** 切租户：成员关系必须仍然可用，成功后重新签发令牌。 */
  async switchTenant(uid: number, tenantId: number) {
    const membership = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId: uid } },
      include: { tenant: true },
    });
    if (!membership) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '你不属于这个租户，无法切换过去',
      );
    }
    if (membership.status !== 1) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        `你已被租户「${membership.tenant.name}」停用`,
      );
    }
    return this.issueSession(uid, tenantId);
  }

  /** 新用户赠送额度：只在「第一条成员身份」上发生一次，记在该租户的额度里。 */
  private async grantWelcomeQuota(uid: number, tenantId: number) {
    const others = await this.prisma.tenantMember.count({
      where: { userId: uid },
    });
    if (others > 1) return;
    const quota = Math.max(
      0,
      Math.floor(await this.settings.getNumber('new_user_quota')),
    );
    if (quota > 0) {
      await this.grantQuota(
        uid,
        tenantId,
        quota,
        'TOPUP',
        uid,
        '新用户注册赠送',
      );
    }
  }

  /** 注册引导：创建租户并把会话切过去（创建者＝该租户管理员）。 */
  async createTenantSession(uid: number, name: string, code: string) {
    // 编码留空时与注册一步走同一条建议编码路径，别让引导页因为「编码必填」卡住
    const suggested = text(code).trim()
      ? code
      : this.suggestedCode((await this.userOrThrow(uid)).username);
    const created = await this.createTenantFor(uid, name, suggested);
    return this.issueSession(uid, created.tenantId);
  }

  /** 注册引导：按编码加入租户并把会话切过去（成为该租户成员）。 */
  async joinTenantSession(uid: number, code: string) {
    const joined = await this.joinTenantFor(uid, code);
    return this.issueSession(uid, joined.tenantId);
  }

  async changePassword(uid: number, oldPassword: string, newPassword: string) {
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user)
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '用户不存在');
    if (!(await verifyPassword(oldPassword, user.passwordHash))) {
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '原密码错误');
    }
    this.assertPassword(newPassword);
    await this.prisma.user.update({
      where: { id: uid },
      data: { passwordHash: await hashPassword(newPassword) },
    });
  }

  /**
   * 安装向导用：建第一个超级管理员。口令与用户名校验走同一套 `assertCredentials`，
   * 已有超管就拒绝——第二次运行向导不能把系统控制权再交出去。
   * 超管是平台直属身份，不属于任何租户，所以这里不建成员关系。
   */
  async createRootAccount(input: {
    username: string;
    password: string;
    displayName?: string;
  }) {
    this.assertCredentials(input.username, input.password);
    const roots = await this.prisma.user.count({ where: { role: ROLE_ROOT } });
    if (roots > 0) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '系统已安装：超级管理员已存在',
      );
    }
    const exists = await this.prisma.user.findUnique({
      where: { username: input.username },
    });
    if (exists) {
      throw new BusinessException(ErrorCode.CONFLICT, '用户名已存在');
    }
    const user = await this.prisma.user.create({
      data: {
        username: input.username,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName || input.username,
        role: ROLE_ROOT,
        affCode: this.randomAffCode(),
      },
    });
    return this.toView(user, [], null);
  }

  /**
   * chandler 联合登录：按平台稳定主体号映射/创建本地影子账户。
   * 平台访问令牌存服务端：预支付接口要求以付款人 Bearer 调用，不能让浏览器持有并回传。
   */
  async upsertChandlerUser(
    chandlerSub: string,
    username: string,
    displayName: string,
    chandlerToken: string,
  ) {
    const existing = await this.prisma.user.findFirst({
      where: { chandlerSub },
    });
    if (existing) {
      await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          displayName: displayName || existing.displayName,
          chandlerToken,
        },
      });
      return this.issueSession(existing.id, null);
    }
    const base =
      username.replace(/[^a-zA-Z0-9_@.-]/g, '').slice(0, 12) || 'user';
    let candidate = `c_${base}`;
    for (
      let i = 0;
      await this.prisma.user.findUnique({ where: { username: candidate } });
      i++
    ) {
      candidate = `c_${base}${i}`;
    }
    const user = await this.prisma.user.create({
      data: {
        username: candidate,
        passwordHash: `chandler$${chandlerSub}`, // 占位：联合登录账户不走本地密码
        displayName: displayName || candidate,
        role: ROLE_USER,
        affCode: this.randomAffCode(),
        chandlerSub,
        chandlerToken,
      },
    });
    return this.issueSession(user.id, null);
  }

  /**
   * 已登录的本地账号绑定 Chandler.work 身份：绑定后支付/权益挂在本账号上，
   * 不会切换会话（联合登录新建影子账户是另一条路径）。
   */
  async linkChandler(uid: number, chandlerSub: string, chandlerToken: string) {
    const current = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!current)
      throw new BusinessException(ErrorCode.UNAUTHORIZED, '用户不存在');
    if (current.chandlerSub && current.chandlerSub !== chandlerSub) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '当前账号已绑定其他 Chandler.work 账号',
      );
    }
    const owner = await this.prisma.user.findFirst({ where: { chandlerSub } });
    if (owner && owner.id !== uid) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        '该 Chandler.work 账号已绑定其他本站账号，请改用该账号登录',
      );
    }
    await this.prisma.user.update({
      where: { id: uid },
      data: { chandlerSub, chandlerToken },
    });
    return this.view(uid, null);
  }

  // ---------- 管理端：全局账号 ----------

  /**
   * 平台「账号管理」列表。归属范围三态：数字＝该租户的成员，null＝没有任何租户的
   * 平台直属账号，undefined＝不筛归属；行上带成员概览，租户内额度/角色只有按租户筛时才有意义。
   */
  async listUsers(
    page: number,
    pageSize: number,
    offset: number,
    keyword = '',
    tenantId?: number | null,
    memberRole?: number,
  ) {
    const where: Prisma.UserWhereInput = {};
    if (keyword) {
      where.OR = [
        { username: { contains: keyword } },
        { displayName: { contains: keyword } },
      ];
    }
    if (tenantId !== undefined) {
      where.memberships =
        tenantId === null
          ? { none: {} }
          : {
              some: {
                tenantId,
                ...(memberRole ? { role: memberRole } : {}),
              },
            };
    }
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);
    const memberships = await this.prisma.tenantMember.findMany({
      where: { userId: { in: rows.map((row) => row.id) } },
      include: { tenant: { select: { id: true, name: true, code: true } } },
      orderBy: { tenantId: 'asc' },
    });
    const byUser = new Map<number, MemberSummary[]>();
    for (const row of memberships) {
      const list = byUser.get(row.userId) || [];
      list.push(row);
      byUser.set(row.userId, list);
    }
    return {
      list: rows.map((row) => {
        const own = (byUser.get(row.id) || []).map((m) => ({
          id: m.tenantId,
          name: m.tenant.name,
          code: m.tenant.code,
          memberRole: m.role,
          memberStatus: m.status,
          quota: m.quota,
          usedQuota: m.usedQuota,
          requestCount: m.requestCount,
          joinedAt: m.joinedAt,
        }));
        const scoped =
          typeof tenantId === 'number' ? own.find((m) => m.id === tenantId) : undefined;
        return {
          id: row.id,
          username: row.username,
          displayName: row.displayName,
          role: row.role,
          status: row.status,
          email: row.email,
          userGroup: row.userGroup,
          affCode: row.affCode,
          chandlerLinked: Boolean(row.chandlerSub),
          lastLoginAt: row.lastLoginAt,
          createdAt: row.createdAt,
          tenantCount: own.length,
          tenants: own,
          ...(scoped
            ? {
                quota: scoped.quota,
                usedQuota: scoped.usedQuota,
                requestCount: scoped.requestCount,
                memberRole: scoped.memberRole,
                memberStatus: scoped.memberStatus,
              }
            : {}),
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async adminCreate(
    operator: { role: number },
    input: {
      username: string;
      password: string;
      displayName?: string;
      role?: number;
      /** 一并加入的租户：建号与成员关系一次做完，租户内额度从这里来。 */
      tenantId?: number | null;
      memberRole?: number;
      quota?: number;
    },
  ) {
    this.assertCredentials(input.username, input.password);
    const role = input.role ?? ROLE_USER;
    this.assertRoleGrantable(operator.role, role);
    const memberRole = input.memberRole ?? MEMBER_ROLE_USER;
    this.assertMemberRole(memberRole);
    const quota = Math.max(0, Math.floor(input.quota ?? 0));
    const tenantId = input.tenantId ?? null;
    if (tenantId) await this.assertTenantUsable(tenantId);
    const exists = await this.prisma.user.findUnique({
      where: { username: input.username },
    });
    if (exists) throw new BusinessException(ErrorCode.CONFLICT, '用户名已存在');
    const user = await this.prisma.user.create({
      data: {
        username: input.username,
        passwordHash: await hashPassword(input.password),
        displayName: input.displayName || input.username,
        role,
        affCode: this.randomAffCode(),
      },
    });
    if (tenantId) {
      await this.prisma.tenantMember.create({
        data: {
          tenantId,
          userId: user.id,
          role: memberRole,
          joinedAt: Math.floor(Date.now() / 1000),
        },
      });
      if (quota > 0) {
        await this.grantQuota(
          user.id,
          tenantId,
          quota,
          'TOPUP',
          user.id,
          '管理员创建初始额度',
        );
      }
    }
    return this.view(user.id, tenantId);
  }

  async adminUpdate(
    operator: { uid: number; role: number },
    uid: number,
    input: {
      displayName?: string;
      email?: string;
      role?: number;
      status?: number;
      password?: string;
    },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!user) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在');
    // 超管账号只能由超管本人处置：普通管理员不得停用超管或重置其密码
    if (user.role >= ROLE_ROOT && operator.role < ROLE_ROOT) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '无权修改超级管理员账号',
      );
    }
    if (input.role !== undefined) {
      this.assertRoleGrantable(operator.role, input.role);
      if (user.role >= ROLE_ROOT && input.role < ROLE_ROOT) {
        const roots = await this.prisma.user.count({
          where: { role: ROLE_ROOT },
        });
        if (roots <= 1) {
          throw new BusinessException(
            ErrorCode.CONFLICT,
            '系统必须保留至少一个超级管理员',
          );
        }
      }
    }
    if (
      input.status !== undefined &&
      uid === operator.uid &&
      input.status !== 1
    ) {
      throw new BusinessException(ErrorCode.CONFLICT, '不能禁用自己的账号');
    }
    if (input.password !== undefined) this.assertPassword(input.password);
    await this.prisma.user.update({
      where: { id: uid },
      data: {
        displayName: input.displayName ?? user.displayName,
        email: input.email ?? user.email,
        role: input.role ?? user.role,
        status: input.status ?? user.status,
        passwordHash:
          input.password !== undefined
            ? await hashPassword(input.password)
            : user.passwordHash,
      },
    });
    return this.view(uid, null);
  }

  /**
   * 管理端额度处置：额度记在成员身份上，所以必须点名在哪个租户里加减。
   * 超管账号只能由超管本人处置（与 adminUpdate 同一条规则），
   * 否则平台管理员可以直接给超管加减额度，绕过角色阶梯。
   */
  async adminGrantQuota(
    operator: { uid: number; role: number },
    uid: number,
    tenantId: number,
    delta: number,
    note: string,
  ) {
    const target = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!target) throw new BusinessException(ErrorCode.NOT_FOUND, '用户不存在');
    if (target.role >= ROLE_ROOT && operator.role < ROLE_ROOT) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '无权处置超级管理员账号',
      );
    }
    return this.grantQuota(
      uid,
      tenantId,
      delta,
      delta >= 0 ? 'ALLOCATE' : 'DEDUCT',
      operator.uid,
      note,
    );
  }

  /** 成员身份是额度的载体：没有这条租户内的成员关系，额度无处可记。 */
  private async mustMembership(tenantId: number, uid: number) {
    const membership = await this.prisma.tenantMember.findUnique({
      where: { tenantId_userId: { tenantId, userId: uid } },
      include: { tenant: { select: { name: true } } },
    });
    if (!membership) {
      throw new BusinessException(
        ErrorCode.NOT_FOUND,
        '该账号不在这个租户里，没有可处置的租户内额度',
      );
    }
    return membership;
  }

  async grantQuota(
    uid: number,
    tenantId: number,
    delta: number,
    type: 'TOPUP' | 'ALLOCATE' | 'DEDUCT' | 'REFUND' | 'SIGNIN',
    operatorUid: number,
    note = '',
  ) {
    const [user, membership] = await Promise.all([
      this.userOrThrow(uid),
      this.mustMembership(tenantId, uid),
    ]);
    const quotaAfter = Math.max(0, membership.quota + delta);
    const applied = delta >= 0 ? delta : quotaAfter - membership.quota; // 负数增量按实际扣减记录
    await this.prisma.tenantMember.update({
      where: { id: membership.id },
      data: { quota: quotaAfter },
    });
    const txn = await this.prisma.quotaTxn.create({
      data: {
        userId: uid,
        tenantId,
        type,
        delta: applied,
        quotaAfter,
        operatorId: operatorUid,
        note,
      },
    });
    await this.prisma.log.create({
      data: {
        userId: uid,
        tenantId,
        type: delta >= 0 ? 1 : 3, // 1 Topup / 3 Manage
        username: user.username,
        quota: Math.abs(applied),
        content: note || type,
      },
    });
    return txn;
  }

  async quotaTxns(
    uid: number,
    page: number,
    pageSize: number,
    offset: number,
    tenantId?: number | null,
  ) {
    const where: Prisma.QuotaTxnWhereInput = {
      userId: uid,
      ...(tenantId === undefined ? {} : { tenantId: tenantId ?? 0 }),
    };
    const [list, total] = await Promise.all([
      this.prisma.quotaTxn.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.quotaTxn.count({ where }),
    ]);
    return { list, total, page, pageSize };
  }

  /**
   * 全平台额度流水台账（管理员）：额度记在「这个人在某个租户里」的成员身份上，
   * 所以每一笔都要看得出动的是谁的、哪个租户的份额、由谁操作，平台侧才核对得出账目。
   * 用户名 / 租户名按当页去重后批量取，不做全库联表。
   */
  async quotaTxnLedger(
    page: number,
    pageSize: number,
    offset: number,
    filter: {
      userId?: number;
      tenantId?: number;
      type?: string;
      keyword: string;
      since?: Date;
    },
  ) {
    const where: Prisma.QuotaTxnWhereInput = {
      ...(filter.userId ? { userId: filter.userId } : {}),
      ...(filter.tenantId === undefined ? {} : { tenantId: filter.tenantId }),
      ...(filter.type ? { type: filter.type } : {}),
      ...(filter.since ? { createdAt: { gte: filter.since } } : {}),
      ...(filter.keyword
        ? {
            OR: [
              { user: { username: { contains: filter.keyword } } },
              { user: { displayName: { contains: filter.keyword } } },
              { note: { contains: filter.keyword } },
            ],
          }
        : {}),
    };
    const [rows, total, sums] = await Promise.all([
      this.prisma.quotaTxn.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.quotaTxn.count({ where }),
      this.prisma.quotaTxn.aggregate({ where, _sum: { delta: true } }),
    ]);
    const userIds = [
      ...new Set(rows.flatMap((row) => [row.userId, row.operatorId])),
    ].filter((id) => id > 0);
    const [people, tenants] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, username: true, displayName: true },
      }),
      this.prisma.tenant.findMany({
        where: { id: { in: [...new Set(rows.map((row) => row.tenantId))] } },
        select: { id: true, name: true },
      }),
    ]);
    const names = new Map(
      people.map((row) => [row.id, row.displayName || row.username]),
    );
    const tenantNames = new Map(tenants.map((row) => [row.id, row.name]));
    return {
      list: rows.map((row) => ({
        ...row,
        username: names.get(row.userId) || `#${row.userId}`,
        tenantName: row.tenantId ? tenantNames.get(row.tenantId) || '' : '',
        operatorName: row.operatorId
          ? names.get(row.operatorId) || `#${row.operatorId}`
          : '',
      })),
      total,
      page,
      pageSize,
      delta: sums._sum.delta || 0,
    };
  }

  /** 我的成员身份（切租户控件用）：停用中的租户也列出来，切换时由服务端点名拒绝。 */
  async myTenants(uid: number) {
    const rows = await this.prisma.tenantMember.findMany({
      where: { userId: uid },
      include: { tenant: { select: { id: true, name: true, code: true, status: true } } },
      orderBy: { tenantId: 'asc' },
    });
    return rows.map((row) => ({
      id: row.tenantId,
      name: row.tenant.name,
      code: row.tenant.code,
      status: row.tenant.status,
      memberRole: row.role,
      memberStatus: row.status,
      quota: row.quota,
      usedQuota: row.usedQuota,
    }));
  }

  private randomAffCode(): string {
    return randomBytes(8).toString('hex');
  }

  /** 自建租户未填编码时的默认值：用户名可用字符 + 随机尾巴，避免撞码。 */
  private suggestedCode(username: string): string {
    const base = username
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '')
      .slice(0, 20);
    return `${base || 'tenant'}-${randomBytes(2).toString('hex')}`;
  }

  private assertCredentials(username: string, password: string) {
    if (!USERNAME_RE.test(username || '')) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '用户名需为 3-20 位字母、数字或 _ @ . -',
      );
    }
    this.assertPassword(password);
  }

  private assertPassword(password: string) {
    if (
      typeof password !== 'string' ||
      password.length < 8 ||
      password.length > 64
    ) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '密码长度需为 8-64 位',
      );
    }
  }

  /** 全局身份阶梯：操作者只能授予不高于自己的身份；超管身份仅超管可授予。 */
  private assertRoleGrantable(operatorRole: number, targetRole: number) {
    if (![ROLE_USER, ROLE_ADMIN, ROLE_ROOT].includes(targetRole)) {
      throw new BusinessException(ErrorCode.VALIDATION_ERROR, '身份不合法');
    }
    if (targetRole > operatorRole) {
      throw new BusinessException(
        ErrorCode.ROLE_MISMATCH,
        '权限不足：不能授予高于自己的身份',
      );
    }
  }

  /** 租户内角色只有两档：1 成员 / 5 租户管理员。 */
  private assertMemberRole(memberRole: number) {
    if (![MEMBER_ROLE_USER, MEMBER_ROLE_ADMIN].includes(memberRole)) {
      throw new BusinessException(
        ErrorCode.VALIDATION_ERROR,
        '租户内权限只有「成员」和「管理员」两档',
      );
    }
  }

  private async assertTenantUsable(tenantId: number) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw new BusinessException(ErrorCode.NOT_FOUND, '租户不存在');
    if (tenant.status !== 1) {
      throw new BusinessException(
        ErrorCode.CONFLICT,
        `租户「${tenant.name}」已被平台停用，不能添加成员`,
      );
    }
  }

  requireAdmin(user: { role: number }) {
    if (user.role < ROLE_ADMIN) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '需要管理员权限');
    }
  }

  /** 影响全平台计费口径 / 上游密钥的动作收给超管，和「模型设置」板块同一门槛。 */
  requireRoot(user: { role: number }) {
    if (user.role < ROLE_ROOT) {
      throw new BusinessException(ErrorCode.ROLE_MISMATCH, '需要超级管理员权限');
    }
  }
}
