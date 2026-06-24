import * as fs from 'fs';
import * as path from 'path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StagedAssetStatus } from '@prisma/client';
import { DatabaseService } from '../common/database/database.service';
import { PublicUrlService } from '../common/storage/public-url.service';
import { parseGcsPublicUrl } from '@shared/storage';

@Injectable()
export class StagedAssetCleanupService {
  private readonly uploadsBaseDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly publicUrlService: PublicUrlService,
    private readonly configService: ConfigService,
  ) {
    this.uploadsBaseDir =
      this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  /**
   * Purge GCS/local files for STAGING and ORPHANED assets after final render completes.
   * COMMITTED assets are retained for workspace regenerate / re-export safety.
   */
  async purgeNonCommittedForProject(projectId: string): Promise<number> {
    const rows = await this.databaseService.stagedAsset.findMany({
      where: {
        projectId,
        status: { in: [StagedAssetStatus.STAGING, StagedAssetStatus.ORPHANED] },
      },
    });

    if (rows.length === 0) {
      return 0;
    }

    let purged = 0;
    for (const row of rows) {
      try {
        await this.deleteStoredFile(row.publicUrl, row.gcsPath, row.localPath);
        await this.databaseService.stagedAsset.update({
          where: { id: row.id },
          data: { status: StagedAssetStatus.PURGED },
        });
        purged++;
      } catch (err: any) {
        console.warn(
          `[StagedAssetCleanup] Failed to purge staged asset ${row.id}: ${err?.message}`,
        );
      }
    }

    console.log(
      `[StagedAssetCleanup] Purged ${purged}/${rows.length} non-committed staged assets for project ${projectId}`,
    );
    return purged;
  }

  private async deleteStoredFile(
    publicUrl: string,
    gcsPath?: string | null,
    localPath?: string | null,
  ): Promise<void> {
    const objectPath = gcsPath || parseGcsPublicUrl(publicUrl)?.objectPath;
    if (objectPath && this.publicUrlService.isGcsAvailable()) {
      try {
        await this.publicUrlService.getUnifiedStorage().deleteFromGcs(objectPath);
      } catch (err: any) {
        console.warn(`[StagedAssetCleanup] GCS delete failed for ${objectPath}: ${err?.message}`);
      }
    }

    const candidates = [localPath, publicUrl.startsWith('/uploads') ? publicUrl : null].filter(
      Boolean,
    ) as string[];

    for (const rel of candidates) {
      const full = rel.startsWith('/')
        ? path.join(this.uploadsBaseDir, rel.replace(/^\/uploads\/?/, ''))
        : path.isAbsolute(rel)
          ? rel
          : path.join(this.uploadsBaseDir, rel);
      if (fs.existsSync(full)) {
        try {
          fs.unlinkSync(full);
        } catch {
          // best effort
        }
      }
    }
  }
}
