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
import { UsersService } from '../users/users.service';
import { TenantsService } from './tenants.service';

/**
 * 平台侧「租户管理」：系统管理员在这里开通/停用租户、划拨与回收额度池、
 * 维护租户成员（建号或拉已有账号进来）并设定他们在本租户内的权限。
 */
@Controller('admin/tenants')
export class AdminTenantsController {
  constructor(
    private readonly tenants: TenantsService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async list(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    this.users.requireAdmin(user);
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize, 20);
    return ok(
      await this.tenants.list(page, pageSize, offset, {
        keyword: text(query.keyword),
        status: text(query.status),
      }),
    );
  }

  @Get('options')
  async options(@Current() user: CurrentUser) {
    this.users.requireAdmin(user);
    return ok(await this.tenants.options());
  }

  @Post()
  async create(
    @Current() user: CurrentUser,
    @Body()
    body: { name?: string; code?: string; contact?: string; remark?: string },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.tenants.create({
        name: text(body?.name),
        code: text(body?.code),
        contact: text(body?.contact),
        remark: text(body?.remark),
      }),
    );
  }

  @Get(':id')
  async detail(@Current() user: CurrentUser, @Param('id') id: string) {
    this.users.requireAdmin(user);
    return ok(await this.tenants.detail(parseId(id, '租户 ID')));
  }

  @Patch(':id')
  async update(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: { name?: string; contact?: string; remark?: string },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.tenants.update(parseId(id, '租户 ID'), {
        name: body?.name,
        contact: body?.contact,
        remark: body?.remark,
      }),
    );
  }

  @Post(':id/status')
  async status(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: { status?: number },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.tenants.setStatus(
        parseId(id, '租户 ID'),
        Number(body?.status ?? 0),
      ),
    );
  }

  /** 额度池划拨（正数）/ 回收（负数），每次变动都留流水。 */
  @Post(':id/pool')
  async pool(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: { delta?: number; note?: string },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.tenants.adjustPool(
        user.uid,
        parseId(id, '租户 ID'),
        Math.trunc(Number(body?.delta ?? 0)),
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
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize, 20);
    return ok(
      await this.tenants.poolTxns(parseId(id, '租户 ID'), page, pageSize, offset),
    );
  }

  /** 下钻：这个租户的成员列表（带全局身份、本租户内权限与额度）。 */
  @Get(':id/users')
  async members(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Query() query: Record<string, string>,
  ) {
    this.users.requireAdmin(user);
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize, 20);
    return ok(
      await this.tenants.membersOfTenant(
        parseId(id, '租户 ID'),
        page,
        pageSize,
        offset,
        text(query.keyword).trim(),
      ),
    );
  }

  /** 建一个新账号并直接设为该租户的管理员（登录后在前台侧栏看到「本租户管理」）。 */
  @Post(':id/admins')
  async createAdmin(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body()
    body: { username?: string; password?: string; displayName?: string },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.tenants.createTenantAdmin(user, parseId(id, '租户 ID'), {
        username: text(body?.username),
        password: text(body?.password),
        displayName: text(body?.displayName),
      }),
    );
  }

  /** 把已有账号加进这个租户（一个账号可以同属多个租户）。 */
  @Post(':id/members')
  async addMember(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: { username?: string; memberRole?: number; quota?: number },
  ) {
    this.users.requireAdmin(user);
    return ok(
      await this.tenants.addMemberToTenant(parseId(id, '租户 ID'), {
        username: text(body?.username),
        memberRole: body?.memberRole,
        quota: body?.quota,
      }),
    );
  }

  /** 设定成员在该租户内的权限（1 成员 / 5 管理员）或启停成员身份。 */
  @Patch(':id/members/:uid')
  async setMember(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Param('uid') uid: string,
    @Body() body: { memberRole?: number; status?: number },
  ) {
    this.users.requireAdmin(user);
    const tenantId = parseId(id, '租户 ID');
    const target = parseId(uid, '用户 ID');
    if (body?.memberRole !== undefined) {
      return ok(
        await this.tenants.setMemberRole(tenantId, target, Number(body.memberRole)),
      );
    }
    return ok(
      await this.tenants.setMemberStatus(tenantId, target, Number(body?.status ?? 0)),
    );
  }

  @Get(':id/entitlements')
  async entitlements(@Current() user: CurrentUser, @Param('id') id: string) {
    this.users.requireAdmin(user);
    return ok(await this.tenants.entitlements(parseId(id, '租户 ID')));
  }
}

/**
 * 本租户管理（当前租户内角色 5，`/console/*`）：租户对自己成员的管理 + 额度池视图。
 * 租户身份一律从会话的「当前租户」推出，接口不接受前端传入 tenantId。
 */
@Controller('console')
export class TenantConsoleController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('overview')
  async overview(@Current() user: CurrentUser) {
    return ok(await this.tenants.consoleOverview(user));
  }

  @Get('users')
  async users(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize, 20);
    return ok(
      await this.tenants.consoleUsers(
        user,
        page,
        pageSize,
        offset,
        text(query.keyword).trim(),
      ),
    );
  }

  @Post('users')
  async createUser(
    @Current() user: CurrentUser,
    @Body()
    body: {
      username?: string;
      password?: string;
      displayName?: string;
      memberRole?: number;
      quota?: number;
    },
  ) {
    return ok(
      await this.tenants.consoleCreateUser(user, {
        username: text(body?.username),
        password: text(body?.password),
        displayName: text(body?.displayName),
        memberRole: body?.memberRole,
        quota: Number(body?.quota ?? 0),
      }),
    );
  }

  /** 拉已有账号进本租户：对方切租户后用的就是本租户划的额度。 */
  @Post('users/join')
  async joinUser(
    @Current() user: CurrentUser,
    @Body() body: { username?: string; memberRole?: number; quota?: number },
  ) {
    return ok(
      await this.tenants.consoleAddMember(user, {
        username: text(body?.username),
        memberRole: body?.memberRole,
        quota: Number(body?.quota ?? 0),
      }),
    );
  }

  @Patch('users/:id')
  async updateUser(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body()
    body: {
      status?: number;
      memberRole?: number;
      displayName?: string;
      email?: string;
    },
  ) {
    return ok(
      await this.tenants.consoleSetMember(user, parseId(id, '用户 ID'), {
        status: body?.status,
        memberRole: body?.memberRole,
        displayName: body?.displayName,
        email: body?.email,
      }),
    );
  }

  @Post('users/:id/password')
  async password(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: { password?: string },
  ) {
    return ok(
      await this.tenants.consoleSetUserPassword(
        user,
        parseId(id, '用户 ID'),
        text(body?.password),
      ),
    );
  }

  /** 额度在本租户额度池与该成员之间转移：正数发放，负数回收。 */
  @Post('users/:id/quota')
  async quota(
    @Current() user: CurrentUser,
    @Param('id') id: string,
    @Body() body: { delta?: number; note?: string },
  ) {
    const tenant = await this.tenants.requireTenant(user);
    return ok(
      await this.tenants.transferQuota(
        tenant.id,
        user.uid,
        parseId(id, '用户 ID'),
        Math.trunc(Number(body?.delta ?? 0)),
        text(body?.note),
      ),
    );
  }

  @Get('pool/txns')
  async poolTxns(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    const tenant = await this.tenants.requireTenant(user);
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize, 20);
    return ok(await this.tenants.poolTxns(tenant.id, page, pageSize, offset));
  }

  /** 模型使用记录：本租户成员的调用与额度流水，租户身份从会话推出。 */
  @Get('logs')
  async logs(
    @Current() user: CurrentUser,
    @Query() query: Record<string, string>,
  ) {
    const { page, pageSize, offset } = pageParam(query.page, query.pageSize, 20);
    const type = Number(query.type);
    return ok(
      await this.tenants.consoleLogs(user, page, pageSize, offset, {
        userId: query.userId ? parseId(query.userId, '用户 ID') : undefined,
        keyword: text(query.keyword).trim(),
        type:
          query.type && Number.isInteger(type) && type >= 0 ? type : undefined,
      }),
    );
  }
}
