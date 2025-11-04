import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../common/database/database.service';
import { CreatePolicyDto, UpdatePolicyDto } from './dto/policies.dto';

@Injectable()
export class PoliciesService {
  constructor(private prisma: PrismaService) {}

  async create(data: CreatePolicyDto) {
    return this.prisma.policy.create({
      data: {
        name: data.name,
        description: data.description,
        entityType: data.entityType,
        entityId: data.entityId,
        permissions: data.permissions,
        conditions: data.conditions,
        priority: data.priority || 0,
      },
    });
  }

  async findAll(entityType?: string, entityId?: string) {
    const where: any = { isActive: true };

    if (entityType && entityId) {
      where.OR = [
        { entityType, entityId },
        { entityType: null, entityId: null },
      ];
    }

    return this.prisma.policy.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
    });
  }

  async findById(id: string) {
    const policy = await this.prisma.policy.findUnique({
      where: { id },
    });

    if (!policy) {
      throw new NotFoundException(`Policy with ID ${id} not found`);
    }

    return policy;
  }

  async update(id: string, data: UpdatePolicyDto) {
    await this.findById(id);

    return this.prisma.policy.update({
      where: { id },
      data,
    });
  }

  async delete(id: string) {
    await this.findById(id);

    return this.prisma.policy.update({
      where: { id },
      data: { isActive: false },
    });
  }
}


