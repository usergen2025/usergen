import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { DatabaseService } from '../common/database/database.service';
import { PublicUrlService } from '../common/storage/public-url.service';
import { ProviderFactory } from './providers/provider-factory.service';
import { ModelRegistryService } from './providers/model-registry.service';
import { ImageGenerationRequest } from './providers/interfaces/image-generation.interface';
import { FalProviderError } from './providers/fal/fal-errors';
import {
  EphemeralPresenterMeta,
  ProductPresentationPlan,
  scriptHasOnModelScenes,
} from '../video/product-presentation.types';

export interface EnsurePresenterResult {
  skipped: boolean;
  reason?: string;
  ephemeralPresenter?: EphemeralPresenterMeta;
}

@Injectable()
export class ProductAdPresenterService {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly providerFactory: ProviderFactory,
    private readonly modelRegistry: ModelRegistryService,
    private readonly publicUrlService: PublicUrlService,
  ) {
    this.uploadsDir =
      this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  async ensureEphemeralPresenter(projectId: string, userId: string): Promise<EnsurePresenterResult> {
    const project = await this.databaseService.videoProject.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new Error('Project not found');
    }
    if (project.userId !== userId) {
      throw new Error('Unauthorized');
    }

    const metadata = (project.metadata as Record<string, unknown> | null) || {};
    const existing = metadata.ephemeralPresenter as EphemeralPresenterMeta | undefined;
    if (existing?.publicUrl) {
      return { skipped: true, reason: 'already_exists', ephemeralPresenter: existing };
    }

    const script =
      typeof project.script === 'string'
        ? JSON.parse(project.script)
        : project.script;
    if (!scriptHasOnModelScenes(script)) {
      return { skipped: true, reason: 'no_on_model_scenes' };
    }

    const plan = metadata.productPresentationPlan as ProductPresentationPlan | undefined;
    if (plan?.humanInteraction === 'discouraged') {
      return { skipped: true, reason: 'human_discouraged' };
    }

    const presenterDescription =
      (typeof script?.presenter_description === 'string'
        ? script.presenter_description.trim()
        : '') ||
      plan?.presenterDescription?.trim() ||
      'Professional Indian commercial fashion model, adult 25-35, neutral studio gray backdrop, front-facing, soft even lighting, waist-up portrait reference, natural confident expression, no product in frame, no microphone, silent ad still';

    const prompt = `Photorealistic commercial model reference plate. ${presenterDescription}. Empty hands, plain neutral clothing without branded logos, no text, no watermark.`;

    const model = this.modelRegistry.getModel('model-4');
    if (!model) {
      throw new Error('model-4 not configured for ephemeral presenter generation');
    }
    const provider = this.providerFactory.getProviderForModel(model.id);

    const request: ImageGenerationRequest = {
      prompt,
      modelId: model.id,
      aspectRatio: '9:16',
      resolution: model.defaultConfig.resolution || '2K',
      numImages: 1,
      outputFormat: (model.defaultConfig.outputFormat as 'png' | 'jpeg' | 'webp') || 'jpeg',
    };

    const validation = provider.validateRequest(request);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid presenter generation request');
    }

    let imageResponse;
    try {
      imageResponse = await provider.generateImage(request);
    } catch (error) {
      if (error instanceof FalProviderError) {
        throw new Error(`Presenter generation failed: ${error.getUserMessage()}`);
      }
      throw error;
    }

    const userDir = path.join(this.uploadsDir, 'images', userId, 'product-ad-presenters');
    if (!fs.existsSync(userDir)) {
      fs.mkdirSync(userDir, { recursive: true });
    }

    const imageFilename = `presenter_${projectId}_${Date.now()}.jpg`;
    const imagePath = path.join(userDir, imageFilename);
    await this.downloadImage(imageResponse.imageUrl, imagePath);

    const localUrl = `/uploads/images/${userId}/product-ad-presenters/${imageFilename}`;
    let publicUrl = localUrl;
    try {
      const storageResult = await this.publicUrlService.uploadFromPath(
        imagePath,
        `images/${userId}/product-ad-presenters`,
        imageFilename,
        'image/jpeg',
      );
      if (storageResult.publicUrl) {
        publicUrl = storageResult.publicUrl;
      }
    } catch (err: any) {
      console.warn(`[ProductAdPresenterService] GCS upload failed: ${err?.message}`);
    }

    const ephemeralPresenter: EphemeralPresenterMeta = {
      publicUrl,
      localUrl,
      localPath: imagePath,
      generatedAt: new Date().toISOString(),
      prompt,
    };

    const currentMetadata =
      project.metadata && typeof project.metadata === 'object' && !Array.isArray(project.metadata)
        ? { ...(project.metadata as Record<string, unknown>) }
        : {};

    await this.databaseService.videoProject.update({
      where: { id: projectId },
      data: {
        metadata: {
          ...currentMetadata,
          ephemeralPresenter,
        } as any,
      },
    });

    console.log(
      `[ProductAdPresenterService] Generated ephemeral presenter for project ${projectId}: ${publicUrl}`,
    );

    return { skipped: false, ephemeralPresenter };
  }

  private async downloadImage(imageUrl: string, outputPath: string): Promise<void> {
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 120000 });
    fs.writeFileSync(outputPath, Buffer.from(response.data));
  }
}
