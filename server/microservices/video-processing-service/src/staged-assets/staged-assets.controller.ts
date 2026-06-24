import {
  Body,
  Controller,
  Param,
  Post,
  Request,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { extractUserIdFromRequest } from '../common/auth/extract-user-id-from-request';
import { StagedAssetsService } from './staged-assets.service';
import {
  CommitStagedAssetsDto,
  OrphanStagedAssetsDto,
  RegisterStagedAssetDto,
} from './dto/staged-asset.dto';

@ApiTags('staged-assets')
@Controller('video-projects/:projectId/staged-assets')
export class StagedAssetsController {
  constructor(
    private readonly stagedAssetsService: StagedAssetsService,
    private readonly configService: ConfigService,
  ) {}

  private extractUserId(req: { headers?: { authorization?: string } }): string {
    const userId = extractUserIdFromRequest(req, this.configService);
    if (!userId) {
      throw new HttpException(
        'Authentication failed. Please login again.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return userId;
  }

  @Post('register')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Register an uploaded asset as STAGING for a project' })
  async register(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: RegisterStagedAssetDto,
  ) {
    const userId = this.extractUserId(req);
    const data = await this.stagedAssetsService.register(projectId, userId, body);
    return { success: true, data };
  }

  @Post('orphan')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Mark deselected staged assets as ORPHANED' })
  async orphan(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: OrphanStagedAssetsDto,
  ) {
    const userId = this.extractUserId(req);
    const data = await this.stagedAssetsService.orphan(projectId, userId, body);
    return { success: true, data };
  }

  @Post('commit')
  @ApiBearerAuth('JWT-auth')
  @ApiParam({ name: 'projectId' })
  @ApiOperation({ summary: 'Commit selected staged assets and queue analysis' })
  async commit(
    @Request() req: any,
    @Param('projectId') projectId: string,
    @Body() body: CommitStagedAssetsDto,
  ) {
    const userId = this.extractUserId(req);
    const data = await this.stagedAssetsService.commit(projectId, userId, body);
    return { success: true, data };
  }
}
