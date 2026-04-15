import { Controller, Get, Query, Param, HttpException, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiParam } from '@nestjs/swagger';
import { StockService, StockSearchRequest } from './stock.service';

@ApiTags('Stock Media')
@Controller('stock')
export class StockController {
  constructor(private readonly stockService: StockService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Search stock media',
    description: 'Search for stock images or videos using Freepik API',
  })
  @ApiQuery({ name: 'term', required: true, description: 'Search term' })
  @ApiQuery({ name: 'type', required: true, enum: ['image', 'video'], description: 'Media type' })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Results per page (default: 20)' })
  @ApiQuery({ name: 'aspectRatio', required: false, enum: ['9:16', '16:9', '1:1'], description: 'Filter by aspect ratio' })
  @ApiQuery({ name: 'targetDuration', required: false, description: 'Target video duration in seconds (enables smart duration matching)' })
  @ApiQuery({ name: 'minDuration', required: false, description: 'Minimum video duration in seconds' })
  @ApiQuery({ name: 'maxDuration', required: false, description: 'Maximum video duration in seconds' })
  @ApiResponse({
    status: 200,
    description: 'Search results returned successfully',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            results: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  type: { type: 'string', enum: ['image', 'video'] },
                  source: { type: 'string' },
                  title: { type: 'string' },
                  thumbnailUrl: { type: 'string' },
                  previewUrl: { type: 'string' },
                  aspectRatio: { type: 'string' },
                  premium: { type: 'boolean' },
                  duration: { type: 'string' },
                  durationSeconds: { type: 'number' },
                  quality: { type: 'string' },
                },
              },
            },
            pagination: {
              type: 'object',
              properties: {
                total: { type: 'number' },
                page: { type: 'number' },
                limit: { type: 'number' },
                totalPages: { type: 'number' },
              },
            },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 503, description: 'Stock service not configured or unavailable' })
  async searchStock(
    @Query('term') term: string,
    @Query('type') type: 'image' | 'video',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('aspectRatio') aspectRatio?: '9:16' | '16:9' | '1:1',
    @Query('targetDuration') targetDuration?: string,
    @Query('minDuration') minDuration?: string,
    @Query('maxDuration') maxDuration?: string,
  ) {
    if (!term) {
      throw new HttpException('Search term is required', HttpStatus.BAD_REQUEST);
    }

    if (!type || !['image', 'video'].includes(type)) {
      throw new HttpException('Type must be either "image" or "video"', HttpStatus.BAD_REQUEST);
    }

    try {
      const request: StockSearchRequest = {
        term,
        type,
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
        aspectRatio,
        targetDuration: targetDuration ? parseFloat(targetDuration) : undefined,
        minDuration: minDuration ? parseFloat(minDuration) : undefined,
        maxDuration: maxDuration ? parseFloat(maxDuration) : undefined,
      };

      const results = await this.stockService.searchStock(request);

      return {
        success: true,
        data: results,
      };
    } catch (error: any) {
      if (error.message.includes('not configured')) {
        throw new HttpException(error.message, HttpStatus.SERVICE_UNAVAILABLE);
      }
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get(':id/download')
  @ApiOperation({
    summary: 'Download stock media item',
    description: 'Download a stock image or video by ID. For videos, optionally trim to target duration, scale to target dimensions, and compress if too large.',
  })
  @ApiParam({ name: 'id', description: 'Stock item ID (e.g., freepik-image-12345)' })
  @ApiQuery({ name: 'type', required: true, enum: ['image', 'video'], description: 'Media type' })
  @ApiQuery({ name: 'projectId', required: false, description: 'Project ID to associate download with' })
  @ApiQuery({ name: 'targetDuration', required: false, description: 'Target video duration in seconds (video will be trimmed if longer)' })
  @ApiQuery({ name: 'maxSizeMB', required: false, description: 'Maximum file size in MB (video will be compressed if larger, default: 100)' })
  @ApiQuery({ name: 'targetWidth', required: false, description: 'Target video width in pixels (video will be scaled/cropped to fit)' })
  @ApiQuery({ name: 'targetHeight', required: false, description: 'Target video height in pixels (video will be scaled/cropped to fit)' })
  @ApiResponse({
    status: 200,
    description: 'Download successful',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        data: {
          type: 'object',
          properties: {
            localPath: { type: 'string' },
            localUrl: { type: 'string' },
            gcsUrl: { type: 'string' },
            publicUrl: { type: 'string' },
            filename: { type: 'string' },
            originalDuration: { type: 'number' },
            finalDuration: { type: 'number' },
            originalSizeMB: { type: 'number' },
            finalSizeMB: { type: 'number' },
            trimmed: { type: 'boolean' },
            extended: { type: 'boolean' },
            compressed: { type: 'boolean' },
            scaled: { type: 'boolean' },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Invalid request parameters' })
  @ApiResponse({ status: 404, description: 'Stock item not found' })
  async downloadStock(
    @Param('id') id: string,
    @Query('type') type: 'image' | 'video',
    @Query('projectId') projectId?: string,
    @Query('targetDuration') targetDuration?: string,
    @Query('maxSizeMB') maxSizeMB?: string,
    @Query('targetWidth') targetWidth?: string,
    @Query('targetHeight') targetHeight?: string,
  ) {
    if (!id) {
      throw new HttpException('Stock ID is required', HttpStatus.BAD_REQUEST);
    }

    if (!type || !['image', 'video'].includes(type)) {
      throw new HttpException('Type must be either "image" or "video"', HttpStatus.BAD_REQUEST);
    }

    // Parse target dimensions if provided
    const targetDimensions = (targetWidth && targetHeight) 
      ? { width: parseInt(targetWidth, 10), height: parseInt(targetHeight, 10) }
      : undefined;

    try {
      const result = await this.stockService.downloadStockItem(
        id,
        type,
        projectId,
        targetDuration ? parseFloat(targetDuration) : undefined,
        maxSizeMB ? parseFloat(maxSizeMB) : 100,
        targetDimensions,
      );

      return {
        success: true,
        data: result,
      };
    } catch (error: any) {
      if (error.message.includes('not found') || error.message.includes('Invalid stock ID')) {
        throw new HttpException(error.message, HttpStatus.NOT_FOUND);
      }
      throw new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
