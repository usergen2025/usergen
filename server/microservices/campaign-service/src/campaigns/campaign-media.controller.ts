import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/auth/guards/jwt-auth.guard';
import { RolesGuard } from '../common/auth/guards/roles.guard';
import { CurrentUser } from '../common/auth/decorators/current-user.decorator';
import { CampaignMediaService } from './campaign-media.service';
import type { Response, Request } from 'express';

@Controller('campaign-media')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CampaignMediaController {
  constructor(private readonly campaignMediaService: CampaignMediaService) {}

  @Get(':assetId/preview')
  streamPreview(
    @Param('assetId') assetId: string,
    @CurrentUser() user: { id: string; role: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    return this.campaignMediaService.streamWatermarkedPreview(assetId, user, res, req);
  }
}
