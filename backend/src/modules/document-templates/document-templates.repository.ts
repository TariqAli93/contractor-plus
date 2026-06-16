import type {
  DocumentCategory,
  DocumentTemplate,
  GeneratedDocument,
  Prisma,
  PrismaClient,
} from '@prisma/client';

type DbClient = PrismaClient | Prisma.TransactionClient;

export class DocumentTemplatesRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // ---------- templates ----------

  list(args: {
    category?: DocumentCategory;
    includeInactive?: boolean;
  }): Promise<DocumentTemplate[]> {
    return this.prisma.documentTemplate.findMany({
      where: {
        deletedAt: null,
        ...(args.category ? { category: args.category } : {}),
        ...(args.includeInactive ? {} : { isActive: true }),
      },
      // Default first, then most recently updated. Keeps the UI predictable.
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    });
  }

  findById(id: string, client: DbClient = this.prisma): Promise<DocumentTemplate | null> {
    return client.documentTemplate.findFirst({ where: { id, deletedAt: null } });
  }

  findBySlug(slug: string, client: DbClient = this.prisma): Promise<DocumentTemplate | null> {
    return client.documentTemplate.findFirst({ where: { slug, deletedAt: null } });
  }

  findDefaultFor(
    category: DocumentCategory,
    client: DbClient = this.prisma,
  ): Promise<DocumentTemplate | null> {
    return client.documentTemplate.findFirst({
      where: { deletedAt: null, isActive: true, isDefault: true, category },
    });
  }

  create(
    data: Prisma.DocumentTemplateCreateInput,
    client: DbClient = this.prisma,
  ): Promise<DocumentTemplate> {
    return client.documentTemplate.create({ data });
  }

  update(
    id: string,
    data: Prisma.DocumentTemplateUpdateInput,
    client: DbClient = this.prisma,
  ): Promise<DocumentTemplate> {
    return client.documentTemplate.update({ where: { id }, data });
  }

  softDelete(id: string, client: DbClient = this.prisma): Promise<DocumentTemplate> {
    return client.documentTemplate.update({
      where: { id },
      data: { deletedAt: new Date(), isDefault: false },
    });
  }

  /**
   * Clear the `isDefault` flag from every template in the same category so
   * the caller can flip a new one to default without violating "at most one
   * default per category" inside a transaction.
   */
  clearDefaultsForCategory(
    category: DocumentCategory,
    client: DbClient = this.prisma,
  ): Promise<Prisma.BatchPayload> {
    return client.documentTemplate.updateMany({
      where: { category, isDefault: true, deletedAt: null },
      data: { isDefault: false },
    });
  }

  // ---------- generated documents ----------

  listGenerated(args: {
    contractId?: string;
    projectId?: string;
    customerId?: string;
    take?: number;
  }): Promise<Array<GeneratedDocument & { template: { name: string } }>> {
    return this.prisma.generatedDocument.findMany({
      where: {
        ...(args.contractId ? { contractId: args.contractId } : {}),
        ...(args.projectId ? { projectId: args.projectId } : {}),
        ...(args.customerId ? { customerId: args.customerId } : {}),
      },
      include: { template: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: args.take ?? 50,
    });
  }

  findGenerated(
    id: string,
    client: DbClient = this.prisma,
  ): Promise<(GeneratedDocument & { template: { name: string } }) | null> {
    return client.generatedDocument.findUnique({
      where: { id },
      include: { template: { select: { name: true } } },
    });
  }

  createGenerated(
    data: Prisma.GeneratedDocumentCreateInput,
    client: DbClient = this.prisma,
  ): Promise<GeneratedDocument> {
    return client.generatedDocument.create({ data });
  }
}
