import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';

@Injectable()
export class AdminService {
  constructor(private databaseService: DatabaseService) {}

  async getAllProjects(query: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }) {
    const page = query.page || 1;
    const limit = query.limit || 20;
    const skip = (page - 1) * limit;

    const where: any = {};

    if (query.status) {
      where.status = query.status;
    }

    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { userId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [projects, total] = await Promise.all([
      this.databaseService.videoProject.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          userId: true,
          title: true,
          videoType: true,
          style: true,
          status: true,
          currentStep: true,
          creditsSpent: true,
          progress: true,
          createdAt: true,
          completedAt: true,
          videoUrl: true,
          thumbnailUrl: true,
        },
      }),
      this.databaseService.videoProject.count({ where }),
    ]);

    return {
      projects,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getProjectById(projectId: string) {
    return this.databaseService.videoProject.findUnique({
      where: { id: projectId },
    });
  }

  async getProjectStats() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalProjects,
      completedProjects,
      projectsToday,
      projectsThisMonth,
      statusBreakdown,
      videoTypeBreakdown,
    ] = await Promise.all([
      this.databaseService.videoProject.count(),
      this.databaseService.videoProject.count({
        where: { status: 'COMPLETED' },
      }),
      this.databaseService.videoProject.count({
        where: {
          createdAt: { gte: startOfDay },
        },
      }),
      this.databaseService.videoProject.count({
        where: {
          createdAt: { gte: startOfMonth },
        },
      }),
      this.databaseService.videoProject.groupBy({
        by: ['status'],
        _count: true,
      }),
      this.databaseService.videoProject.groupBy({
        by: ['videoType'],
        _count: true,
      }),
    ]);

    return {
      totalProjects,
      completedProjects,
      projectsToday,
      projectsThisMonth,
      statusBreakdown: statusBreakdown.reduce((acc, item) => {
        acc[item.status] = item._count;
        return acc;
      }, {} as Record<string, number>),
      videoTypeBreakdown: videoTypeBreakdown.reduce((acc, item) => {
        acc[item.videoType] = item._count;
        return acc;
      }, {} as Record<string, number>),
    };
  }

  async getUserProjectStats(userId: string) {
    const [totalProjects, completedProjects, totalCreditsSpent] = await Promise.all([
      this.databaseService.videoProject.count({
        where: { userId },
      }),
      this.databaseService.videoProject.count({
        where: { userId, status: 'COMPLETED' },
      }),
      this.databaseService.videoProject.aggregate({
        where: { userId },
        _sum: { creditsSpent: true },
      }),
    ]);

    return {
      totalProjects,
      completedProjects,
      totalCreditsSpent: totalCreditsSpent._sum.creditsSpent || 0,
    };
  }
}
