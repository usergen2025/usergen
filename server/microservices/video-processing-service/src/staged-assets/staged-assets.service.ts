import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { StagedAssetStatus } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import { VideoService } from '../video/video.service';
import { normalizeWebsiteUrl } from '@shared/utils/normalize-website-url';
import { metadataHasLogoAsset } from '@shared/brand';
import {
  CommitStagedAssetsDto,
  OrphanStagedAssetsDto,
  RegisterStagedAssetDto,
} from './dto/staged-asset.dto';

@Injectable()
export class StagedAssetsService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly videoService: VideoService,
  ) {}

  async register(
    projectId: string,
    userId: string,
    dto: RegisterStagedAssetDto,
  ) {
    await this.assertProjectOwned(projectId, userId);

    const existing = await this.databaseService.stagedAsset.findFirst({
      where: { projectId, clientAssetId: dto.clientAssetId },
    });

    if (existing) {
      return this.databaseService.stagedAsset.update({
        where: { id: existing.id },
        data: {
          category: dto.category,
          publicUrl: dto.publicUrl,
          localPath: dto.localPath,
          gcsPath: dto.gcsPath,
          mimeType: dto.mimeType,
          assetType: dto.assetType || 'image',
          status: StagedAssetStatus.STAGING,
        },
      });
    }

    return this.databaseService.stagedAsset.create({
      data: {
        userId,
        projectId,
        clientAssetId: dto.clientAssetId,
        category: dto.category,
        publicUrl: dto.publicUrl,
        localPath: dto.localPath,
        gcsPath: dto.gcsPath,
        mimeType: dto.mimeType,
        assetType: dto.assetType || 'image',
        status: StagedAssetStatus.STAGING,
      },
    });
  }

  async orphan(projectId: string, userId: string, dto: OrphanStagedAssetsDto) {
    await this.assertProjectOwned(projectId, userId);

    if (!dto.clientAssetIds?.length) {
      return { updated: 0 };
    }

    const result = await this.databaseService.stagedAsset.updateMany({
      where: {
        projectId,
        userId,
        clientAssetId: { in: dto.clientAssetIds },
        status: StagedAssetStatus.STAGING,
      },
      data: { status: StagedAssetStatus.ORPHANED },
    });

    return { updated: result.count };
  }

  async commit(projectId: string, userId: string, dto: CommitStagedAssetsDto) {
    await this.assertProjectOwned(projectId, userId);

    if (!dto.assets?.length) {
      throw new BadRequestException('At least one asset is required to commit');
    }

    const committedClientIds = dto.assets.map((a) => a.clientAssetId);

    await this.databaseService.stagedAsset.updateMany({
      where: {
        projectId,
        userId,
        status: StagedAssetStatus.STAGING,
        clientAssetId: { notIn: committedClientIds },
      },
      data: { status: StagedAssetStatus.ORPHANED },
    });

    const metadataAssets: Array<Record<string, unknown>> = [];

    for (const item of dto.assets) {
      const type = item.type || 'image';
      let url = item.url;

      if (type === 'image') {
        const staged = await this.databaseService.stagedAsset.findFirst({
          where: {
            projectId,
            userId,
            clientAssetId: item.clientAssetId,
            status: { in: [StagedAssetStatus.STAGING, StagedAssetStatus.COMMITTED] },
          },
        });

        if (!staged) {
          throw new BadRequestException(
            `Staged asset not found or not ready: ${item.clientAssetId}`,
          );
        }

        url = staged.publicUrl;

        await this.databaseService.stagedAsset.update({
          where: { id: staged.id },
          data: {
            status: StagedAssetStatus.COMMITTED,
            category: item.category,
            committedAt: new Date(),
          },
        });

        metadataAssets.push({
          id: item.clientAssetId,
          url: staged.publicUrl,
          localPath: staged.localPath,
          type: 'image',
          category: item.category,
          label: item.label || item.category,
          userLabel: item.category,
          stagedAssetId: staged.id,
        });
      } else {
        const normalized = normalizeWebsiteUrl(url || '') || url;
        if (!normalized) {
          throw new BadRequestException(`Invalid URL for asset ${item.clientAssetId}`);
        }

        metadataAssets.push({
          id: item.clientAssetId,
          url: normalized,
          type: 'url',
          category: item.category || 'reference',
          label: item.label || normalized,
          userLabel: item.category || 'reference',
        });
      }
    }

    if (metadataAssets.length === 0) {
      throw new BadRequestException('No valid assets to commit');
    }

    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) {
      throw new NotFoundException('Video project not found');
    }

    const existingMeta =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? (project.metadata as Record<string, unknown>)
        : {};

    const fingerprint = this.videoService.computeAssetsFingerprint(
      metadataAssets.map((a) => ({
        id: String(a.id),
        url: String(a.url),
      })),
    );

    const priorAnalysis = (existingMeta.assetAnalysis || {}) as Record<string, unknown>;
    const oldFingerprint = priorAnalysis.assetsFingerprint as string | undefined;

    const nextMeta: Record<string, unknown> = {
      ...existingMeta,
      assets: metadataAssets,
      assetAnalysis: {
        ...priorAnalysis,
        status: 'pending',
        assetsFingerprint: fingerprint,
        totalAssets: metadataAssets.length,
        updatedAt: new Date().toISOString(),
      },
      aiChatStep: 'assets-attached',
    };

    if (fingerprint !== oldFingerprint) {
      delete nextMeta.logoBrand;
      delete nextMeta.analyzedAssets;
      delete nextMeta.brandPackaging;
      delete nextMeta.brandPackagingApplied;
      delete nextMeta.productPresentationPlan;
    }

    const updated = await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: { metadata: nextMeta as any },
    });

    const hasLogo = metadataHasLogoAsset(metadataAssets as any);
    console.log(
      `[StagedAssetsService] Committed ${metadataAssets.length} assets for ${projectId}, logo=${hasLogo}`,
    );

    await this.videoService.queueAssetAnalysis(projectId, userId, metadataAssets as any);

    return {
      project: updated,
      assets: metadataAssets,
    };
  }

  private async assertProjectOwned(projectId: string, userId: string) {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId, userId },
    });
    if (!project) {
      throw new NotFoundException('Video project not found');
    }
    return project;
  }
}
