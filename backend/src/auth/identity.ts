import type { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma/prisma.service';

export type MembershipRow = Prisma.TenantMemberGetPayload<object>;

/**
 * 一个人的全部成员身份。切租户、判定「当前租户内是什么角色」都从这张表出发，
 * 不看 `user.role`——全局身份与租户内角色是两个轴。
 */
export async function loadMemberships(
  prisma: PrismaService,
  uid: number,
): Promise<MembershipRow[]> {
  return prisma.tenantMember.findMany({
    where: { userId: uid },
    orderBy: { tenantId: 'asc' },
  });
}

/**
 * 当前租户：令牌里的租户优先；这条成员关系被停用或删掉时退到第一个可用租户。
 * 退而不是报错——成员被某个租户移除，不该连带把他别的租户会话一起打死。
 */
export function pickActiveMembership<T extends { tenantId: number; status: number }>(
  rows: T[],
  hint: number | null,
): T | null {
  const usable = rows.filter((row) => row.status === 1);
  return usable.find((row) => row.tenantId === hint) ?? usable[0] ?? null;
}
