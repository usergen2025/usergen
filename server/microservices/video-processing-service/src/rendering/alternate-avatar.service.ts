import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import * as fs from 'fs';
import { DatabaseService } from '../common/database/database.service';
import { RenderingService } from './rendering.service';
import { HeyGenVideoProvider } from './providers/heygen-video.provider';
import { VideoCompositorProvider } from './providers/video-compositor.provider';

@Injectable()
export class AlternateAvatarService {
  private readonly uploadsDir: string;

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly configService: ConfigService,
    private readonly renderingService: RenderingService,
    private readonly heygenVideoProvider: HeyGenVideoProvider,
    private readonly videoCompositor: VideoCompositorProvider,
  ) {
    this.uploadsDir = this.configService.get<string>('UPLOADS_DIR') || path.join(process.cwd(), 'uploads');
  }

  private getStyleDirectoryName(style: string | null | undefined): string {
    if (!style) return 'unknown';
    return style.toLowerCase().replace(/_/g, '-');
  }

  /**
   * Generate a per-scene avatar video for ALTERNATE style (odd / half-n-half scenes)
   * Returns the local file path of the generated avatar video
   */
  async generateAlternateSceneAvatarVideo(
    projectId: string,
    userId: string,
    sceneNumber: number,
    audioFilePath: string,
    authToken?: string
  ): Promise<string> {
    const project = await this.databaseService.videoProject.findFirst({
      where: { id: projectId },
    });
    if (!project || !project.avatarId) {
      throw new Error('Project or avatar ID not found');
    }

    const metadata = (project.metadata as any) || {};
    const imageKeyToUse = metadata.generatedAvatarImageKey as string | undefined;
    if (!imageKeyToUse) {
      throw new Error(
        'Avatar image for this project has not been generated yet. Please complete the b-roll images step, then try again.',
      );
    }

    const isAIChatFlow = metadata.generationFlow === 'AI_CHAT';
    const avatarMode = (project.avatarMode as string) || (isAIChatFlow ? 'PREMIUM' : 'BASIC');
    const avatarType = avatarMode.toLowerCase();
    const styleType = this.getStyleDirectoryName(project.style);
    const avatarDir = path.join(this.uploadsDir, 'videos', userId, 'avatars', projectId, styleType, avatarType);
    if (!fs.existsSync(avatarDir)) {
      fs.mkdirSync(avatarDir, { recursive: true });
    }

    const audioBuffer = fs.readFileSync(audioFilePath);
    const audioAssetId = await this.heygenVideoProvider.uploadAudio(audioBuffer, `scene_${sceneNumber}_audio.mp3`);

    const sceneAudioDuration = await this.videoCompositor.getVideoDuration(audioFilePath);
    const maxPoll = this.renderingService.calculateMaxPollingAttempts(sceneAudioDuration);

    const completedVideo = await this.renderingService.generateAndPollAvatarIVUnified(
      project,
      {
        image_key: imageKeyToUse,
        video_title: `Avatar Video Scene ${sceneNumber} - ${projectId}`,
        audio_asset_id: audioAssetId,
        video_orientation: 'portrait',
        fit: 'cover',
      },
      maxPoll,
      5000,
    );
    if (!completedVideo.data.video_url) {
      throw new Error(`Avatar video generation completed but no video URL for scene ${sceneNumber}`);
    }

    const avatarVideoPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_${projectId}.mp4`);
    await this.heygenVideoProvider.downloadVideo(completedVideo.data.video_url, avatarVideoPath);

    if (avatarMode === 'PREMIUM') {
      const videoRes = await this.videoCompositor.getVideoResolution(avatarVideoPath);
      if (!videoRes) throw new Error('Failed to get video resolution for avatar video');

      const needCrop = videoRes.width !== 1080 || videoRes.height !== 1920;
      let pathToCrop = avatarVideoPath;

      if (needCrop && (videoRes.width !== 1080 || videoRes.height !== 1920)) {
        const scaledPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_scaled_${projectId}.mp4`);
        await this.videoCompositor.scaleVideoToDimensions(avatarVideoPath, scaledPath, 1080, 1920);
        if (fs.existsSync(scaledPath)) pathToCrop = scaledPath;
      }

      const croppedPath = path.join(avatarDir, `avatar_scene_${sceneNumber}_cropped_${projectId}.mp4`);
      await this.videoCompositor.cropVideo(pathToCrop, croppedPath, 0, 960, 1080, 960);

      if (fs.existsSync(croppedPath)) {
        if (pathToCrop !== avatarVideoPath && fs.existsSync(pathToCrop)) fs.unlinkSync(pathToCrop);
        if (fs.existsSync(avatarVideoPath)) fs.unlinkSync(avatarVideoPath);
        fs.renameSync(croppedPath, avatarVideoPath);
      }
    }

    return avatarVideoPath;
  }
}
