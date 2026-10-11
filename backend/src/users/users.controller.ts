import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Current } from '../auth/current-user.decorator';
import { CurrentUser } from '../auth/current-user';
import { ok, pageParam, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { UsersService } from './users.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly users: UsersService) {}

  /**
   * 注册。可带 tenantMode 一步把租户定下来；不带则落在「还没选租户」的会话上，
   * 由前端引导页接着调 create/join。
   */
  @Post('register')
  async register(
    @Body()
    body: {
      username?: string;
      password?: string;
      displayName?: string;
      tenantMode?: string;
      tenantName?: string;
      tenantCode?: string;
    },
  ) {
    const mode = text(body?.tenantMode) === 'join' ? 'join' : text(body?.tenantMode) === 'create' ? 'create' : undefined;
    const session = await this.users.register(
      text(body?.username),
      text(body?.password),
      text(body?.displayName),
      mode
        ? {
            mode,
            name: text(body?.tenantName),
            code: text(body?.tenantCode),
          }
        : undefined,
    );
    return ok(session);
  }

  @Post('login')
  async login(@Body() body: { username?: string; password?: string }) {
    const session = await this.users.login(
      text(body?.username),
      text(body?.password),
    );
    return ok(session);
  }

  @Post('refresh')
  async refresh(@Body() body: { refreshToken?: string }) {
    const session = await this.users.refresh(text(body?.refreshToken));
    return ok(session);
  }

  @Get('me')
  async me(@Current() user: CurrentUser) {
    return ok(await this.users.me(user));
  }

  /** 我所属的租户（切租户控件的数据源）。 */
  @Get('tenants')
  async tenants(@Current() user: CurrentUser) {
    return ok(await this.users.myTenants(user.uid));
  }

  /** 引导 / 后续新增：创建一个租户，自己成为该租户的管理员。 */
  @Post('tenants/create')
  async createTenant(
    @Current() user: CurrentUser,
    @Body() body: { name?: string; code?: string },
  ) {
    return ok(
      await this.users.createTenantSession(
        user.uid,
        text(body?.name),
        text(body?.code),
      ),
    );
  }

  /** 引导 / 后续新增：按租户编码加入，成为该租户的普通成员。 */
  @Post('tenants/join')
  async joinTenant(
    @Current() user: CurrentUser,
    @Body() body: { code?: string },
  ) {
    return ok(
      await this.users.joinTenantSession(user.uid, text(body?.code)),
    );
  }

  /** 切租户：重新签发会话令牌，之后的额度、令牌、日志都落在目标租户里。 */
  @Post('tenants/switch')
  async switchTenant(
    @Current() user: CurrentUser,
    @Body() body: { tenantId?: number },
  ) {
    return ok(
      await this.users.switchTenant(user.uid, parseId(String(body?.tenantId), '租户 ID')),
    );
  }

  @Post('password')
  async password(
    @Current() user: CurrentUser,
    @Body() body: { oldPassword?: string; newPassword?: string },
  ) {
    await this.users.changePassword(
      user.uid,
      text(body?.oldPassword),
      text(body?.newPassword),
    );
    return ok(null);
  }
}

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async list(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    this.users.requireAdmin(user);
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    // 归属范围三态：不传＝全部；none＝没有任何租户的账号；数字＝该租户的成员
    const tenantScope =
      query.tenantId === 'none'
        ? null
        : query.tenantId
          ? parseId(query.tenantId, '租户 ID')
          : undefined;
    const memberRole = query.memberRole ? Number(query.memberRole) : undefined;
    return ok(
      await this.users.listUsers(
        page,
        pageSize,
        offset,
        text(query.keyword).trim(),
        tenantScope,
        memberRole,
      ),
    );
  }

  @Post()
  async create(
    @Current() user: CurrentUser,
    @Body()
    body: {
      username?: string;
      password?: string;
      displayName?: string;
      role?: number;
      tenantId?: number;
      memberRole?: number;
      quota?: number;
    },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.users.adminCreate(user, {
        username: text(body?.username),
        password: text(body?.password),
        displayName: text(body?.displayName),
        role: Number(body?.role ?? 1),
        tenantId: body?.tenantId ? parseId(String(body.tenantId), '租户 ID') : null,
        memberRole: body?.memberRole === undefined ? undefined : Number(body.memberRole),
        quota: Number(body?.quota ?? 0),
      }),
    );
  }

  @Patch(':id')
  async update(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body()
    body: {
      displayName?: string;
      email?: string;
      role?: number;
      status?: number;
      password?: string;
    },
  ) {
    this.users.requireAdmin(user);
    const uid = parseId(id, '用户 ID');
    const input: Record<string, unknown> = {};
    if (body?.displayName !== undefined)
      input.displayName = text(body.displayName);
    if (body?.email !== undefined) input.email = text(body.email);
    if (body?.role !== undefined) input.role = Number(body.role);
    if (body?.status !== undefined) input.status = Number(body.status);
    if (body?.password) input.password = text(body.password);
    return ok(await this.users.adminUpdate(user, uid, input));
  }

  /**
   * 额度处置必须点名租户：额度记在「这个人在这家租户里」的成员身份上，
   * 同一个人跨租户各有一份，不指定就没法知道动哪一份。
   */
  @Post(':id/quota')
  async quota(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: { delta?: number; tenantId?: number; note?: string },
  ) {
    this.users.requireAdmin(user);
    const delta = Math.trunc(Number(body?.delta ?? 0));
    if (!Number.isFinite(delta) || delta === 0) {
      return ok(null);
    }
    return ok(
      await this.users.adminGrantQuota(
        { uid: user.uid, role: user.role },
        parseId(id, '用户 ID'),
        parseId(String(body?.tenantId), '租户 ID'),
        delta,
        text(body?.note),
      ),
    );
  }

  @Get(':id/txns')
  async txns(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    this.users.requireAdmin(user);
    const { page, pageSize, offset } = pageParam(
      query.page,
      query.pageSize,
      20,
    );
    return ok(
      await this.users.quotaTxns(
        parseId(id, '用户 ID'),
        page,
        pageSize,
        offset,
        query.tenantId ? parseId(query.tenantId, '租户 ID') : undefined,
      ),
    );
  }
}
