import type { Prisma, PrismaClient, TunnelState } from '@prisma/client';

// TunnelState is a singleton row. We create it lazily on first read and
// upsert it on every state change. No optimistic transitions — the
// enable-in-flight guard lives in the service.
export class TunnelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreate(): Promise<TunnelState> {
    const existing = await this.prisma.tunnelState.findFirst();
    if (existing) return existing;
    return this.prisma.tunnelState.create({ data: {} });
  }

  update(id: string, data: Prisma.TunnelStateUpdateInput): Promise<TunnelState> {
    return this.prisma.tunnelState.update({ where: { id }, data });
  }
}
