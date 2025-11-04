import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

export interface HeyGenUploadResponse {
  code?: number;
  data: {
    id: string;
    name: string;
    file_type: 'image' | 'video' | 'audio';
    folder_id?: string;
    meta?: any;
    image_key?: string;
    url?: string;
  };
  msg?: string;
  message?: string;
}

export interface HeyGenCreateGroupResponse {
  code: number;
  data: {
    id: string;
    name?: string;
    image_keys?: string[];
  };
  msg?: string;
}

export interface HeyGenTrainResponse {
  code: number;
  data: {
    job_id: string;
    status: string;
  };
  msg?: string;
}

export interface HeyGenTrainStatusResponse {
  code: number;
  data: {
    status: string;
    progress?: number;
    avatar_id?: string;
  };
  msg?: string;
}

export interface HeyGenGenerateLooksResponse {
  code: number;
  data: {
    job_id: string;
    avatar_id?: string;
  };
  msg?: string;
}

export interface HeyGenAddMotionResponse {
  code: number;
  data: {
    avatar_id: string;
    url?: string;
  };
  msg?: string;
}

@Injectable()
export class HeyGenProvider {
  private readonly logger = new Logger(HeyGenProvider.name);
  private readonly apiKey: string;
  private readonly uploadClient: AxiosInstance;
  private readonly apiClient: AxiosInstance;

  constructor(private readonly configService: ConfigService) {
    this.apiKey = this.configService.get<string>('HEYGEN_API_KEY', '');
    
    if (!this.apiKey) {
      this.logger.warn('HeyGen API key not configured');
    }

    // Upload endpoint client
    this.uploadClient = axios.create({
      baseURL: 'https://upload.heygen.com/v1',
      headers: {
        'X-Api-Key': this.apiKey,
      },
      timeout: 60000, // 60 seconds for file uploads
    });

    // API endpoint client
    this.apiClient = axios.create({
      baseURL: 'https://api.heygen.com/v2',
      headers: {
        'X-Api-Key': this.apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }

  /**
   * Upload image to HeyGen
   * Returns image_key that can be used for avatar creation
   */
  async uploadImage(imageBuffer: Buffer, contentType: 'image/jpeg' | 'image/png', filename?: string): Promise<HeyGenUploadResponse['data']> {
    try {
      this.logger.log(`Uploading image to HeyGen: ${filename || 'unnamed'}`);

      const response = await this.uploadClient.post<HeyGenUploadResponse>(
        '/asset',
        imageBuffer,
        {
          headers: {
            'Content-Type': contentType,
          },
        }
      );

      const data = response.data.code !== undefined ? response.data.data : (response.data as any);
      
      if (!data.image_key) {
        throw new Error('Failed to get image_key from HeyGen upload response');
      }

      this.logger.log(`Image uploaded successfully. Image key: ${data.image_key}`);
      return data;
    } catch (error: any) {
      this.logger.error(`Failed to upload image to HeyGen: ${error.message}`, error.stack);
      throw new Error(`HeyGen upload failed: ${error.response?.data?.msg || error.response?.data?.message || error.message}`);
    }
  }

  /**
   * Create photo avatar group
   * According to HeyGen API: https://docs.heygen.com/reference/create-photo-avatar-group
   * Requires: name, image_key (string), generation_id (asset ID from upload)
   * Returns: { avatarId: string, groupId: string }
   */
  async createPhotoAvatarGroup(imageKey: string, generationId: string, name?: string): Promise<{ avatarId: string; groupId: string }> {
    try {
      this.logger.log(`Creating photo avatar group with image_key: ${imageKey}, generation_id: ${generationId}`);

      const payload = {
        image_key: imageKey, // Single string, not array
        generation_id: generationId, // Asset ID from upload
        name: name || `Avatar Group ${Date.now()}`,
      };

      this.logger.debug(`HeyGen create group payload: ${JSON.stringify(payload)}`);

      const response = await this.apiClient.post<any>(
        '/photo_avatar/avatar_group/create',
        payload
      );

      // HeyGen API returns different response formats:
      // Format 1: { error: null, data: { id: "...", group_id: "..." } } - Success
      // Format 2: { code: 100, data: { id: "..." } } - Success  
      // Format 3: { error: { code: "...", message: "..." }, data: null } - Error
      // Format 4: { code: !100, msg: "..." } - Error

      // Check for error format first (error is not null and has error details)
      if (response.data.error && response.data.error !== null && typeof response.data.error === 'object') {
        const errorMessage = response.data.error.message || response.data.error.code || 'Failed to create avatar group';
        this.logger.error(`HeyGen API error: ${JSON.stringify(response.data)}`);
        throw new Error(errorMessage);
      }

      // Check for code-based error format (code exists and is not 100)
      if (response.data.code !== undefined && response.data.code !== 100) {
        this.logger.error(`HeyGen API error: ${JSON.stringify(response.data)}`);
        throw new Error(response.data.msg || 'Failed to create avatar group');
      }

      // Extract avatar ID and group ID from different possible locations
      // data.id is the avatar ID (used for add_motion)
      // data.group_id is the group ID
      const avatarId = response.data.data?.id || response.data.id;
      const groupId = response.data.data?.group_id || response.data.data?.id || response.data.group_id || response.data.id;

      if (!avatarId || !groupId) {
        this.logger.error(`HeyGen response missing IDs: ${JSON.stringify(response.data)}`);
        throw new Error('Failed to get avatar ID or group ID from HeyGen response');
      }

      this.logger.log(`Avatar group created successfully. Avatar ID: ${avatarId}, Group ID: ${groupId}`);
      return { avatarId, groupId };
    } catch (error: any) {
      if (error.response) {
        const errorData = error.response.data;
        
        // Extract error message from various possible formats
        let errorMessage = 'Failed to create avatar group';
        
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        } else if (errorData?.error?.code) {
          errorMessage = errorData.error.code;
        } else if (errorData?.msg) {
          errorMessage = errorData.msg;
        } else if (errorData?.message) {
          errorMessage = errorData.message;
        }
        
        this.logger.error(
          `HeyGen API error response: Status ${error.response.status}, Data: ${JSON.stringify(errorData)}`,
          error.stack
        );
        
        throw new Error(`HeyGen create group failed: ${errorMessage}`);
      }
      this.logger.error(`Failed to create avatar group: ${error.message}`, error.stack);
      throw new Error(`HeyGen create group failed: ${error.message}`);
    }
  }

  /**
   * Add looks to photo avatar group
   */
  async addLooksToGroup(groupId: string, imageKeys: string[]): Promise<void> {
    try {
      this.logger.log(`Adding ${imageKeys.length} look(s) to group ${groupId}`);

      const response = await this.apiClient.post(
        `/photo_avatar/avatar_group/${groupId}/add_looks`,
        {
          image_keys: imageKeys,
        }
      );

      if (response.data.code !== 100) {
        throw new Error(response.data.msg || 'Failed to add looks to group');
      }

      this.logger.log(`Looks added successfully to group ${groupId}`);
    } catch (error: any) {
      this.logger.error(`Failed to add looks to group: ${error.message}`, error.stack);
      throw new Error(`HeyGen add looks failed: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * Train photo avatar group
   * Returns job_id for status polling
   */
  async trainPhotoAvatarGroup(groupId: string): Promise<string> {
    try {
      this.logger.log(`Training photo avatar group: ${groupId}`);

      const response = await this.apiClient.post<HeyGenTrainResponse>(
        `/photo_avatar/avatar_group/${groupId}/train`,
        {}
      );

      if (response.data.code !== 100) {
        throw new Error(response.data.msg || 'Failed to start training');
      }

      const jobId = response.data.data.job_id;
      this.logger.log(`Training started. Job ID: ${jobId}`);
      return jobId;
    } catch (error: any) {
      this.logger.error(`Failed to train avatar group: ${error.message}`, error.stack);
      throw new Error(`HeyGen train failed: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * Get training job status
   */
  async getTrainingStatus(jobId: string): Promise<HeyGenTrainStatusResponse['data']> {
    try {
      const response = await this.apiClient.get<HeyGenTrainStatusResponse>(
        `/photo_avatar/check_generation_status?job_id=${jobId}`
      );

      if (response.data.code !== 100) {
        throw new Error(response.data.msg || 'Failed to get training status');
      }

      return response.data.data;
    } catch (error: any) {
      this.logger.error(`Failed to get training status: ${error.message}`, error.stack);
      throw new Error(`HeyGen get status failed: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * Generate photo avatar looks
   * Returns job_id for status polling
   */
  async generatePhotoAvatarLooks(groupId: string, prompt?: string): Promise<string> {
    try {
      this.logger.log(`Generating photo avatar looks for group: ${groupId}`);

      const response = await this.apiClient.post<HeyGenGenerateLooksResponse>(
        `/photo_avatar/generate_photo_avatar_looks`,
        {
          group_id: groupId,
          prompt: prompt || 'Generate professional avatar looks',
        }
      );

      if (response.data.code !== 100) {
        throw new Error(response.data.msg || 'Failed to generate looks');
      }

      const jobId = response.data.data.job_id;
      this.logger.log(`Look generation started. Job ID: ${jobId}`);
      return jobId;
    } catch (error: any) {
      this.logger.error(`Failed to generate looks: ${error.message}`, error.stack);
      throw new Error(`HeyGen generate looks failed: ${error.response?.data?.msg || error.message}`);
    }
  }

  /**
   * Add motion to photo avatar
   * According to HeyGen API: https://docs.heygen.com/reference/add-motion
   * Requires: id (photo avatar id), optional: prompt, motion_type
   */
  async addMotion(avatarId: string, prompt?: string, motionType: string = 'consistent'): Promise<string> {
    try {
      this.logger.log(`Adding motion to avatar: ${avatarId}, motion_type: ${motionType}`);

      const payload: any = {
        id: avatarId,
      };

      if (prompt) {
        payload.prompt = prompt;
      }

      if (motionType) {
        payload.motion_type = motionType;
      }

      this.logger.debug(`HeyGen add motion payload: ${JSON.stringify(payload)}`);

      const response = await this.apiClient.post<any>(
        '/photo_avatar/add_motion',
        payload
      );

      // Handle different response formats
      if (response.data.error && response.data.error !== null && typeof response.data.error === 'object') {
        const errorMessage = response.data.error.message || response.data.error.code || 'Failed to add motion';
        this.logger.error(`HeyGen API error: ${JSON.stringify(response.data)}`);
        throw new Error(errorMessage);
      }

      if (response.data.code !== undefined && response.data.code !== 100) {
        this.logger.error(`HeyGen API error: ${JSON.stringify(response.data)}`);
        throw new Error(response.data.msg || 'Failed to add motion');
      }

      // Extract new avatar ID from different possible locations
      const newAvatarId = response.data.data?.avatar_id || 
                         response.data.data?.id ||
                         response.data.avatar_id ||
                         response.data.id;

      if (!newAvatarId) {
        this.logger.error(`HeyGen response missing new avatar ID: ${JSON.stringify(response.data)}`);
        throw new Error('Failed to get new avatar ID from HeyGen response');
      }

      this.logger.log(`Motion added successfully. New Avatar ID: ${newAvatarId}`);
      return newAvatarId;
    } catch (error: any) {
      if (error.response) {
        const errorData = error.response.data;
        let errorMessage = 'Failed to add motion';
        
        if (errorData?.error?.message) {
          errorMessage = errorData.error.message;
        } else if (errorData?.error?.code) {
          errorMessage = errorData.error.code;
        } else if (errorData?.msg) {
          errorMessage = errorData.msg;
        } else if (errorData?.message) {
          errorMessage = errorData.message;
        }
        
        this.logger.error(
          `HeyGen API error response: Status ${error.response.status}, Data: ${JSON.stringify(errorData)}`,
          error.stack
        );
        
        throw new Error(`HeyGen add motion failed: ${errorMessage}`);
      }
      this.logger.error(`Failed to add motion: ${error.message}`, error.stack);
      throw new Error(`HeyGen add motion failed: ${error.message}`);
    }
  }

  /**
   * Get photo avatar details
   */
  async getPhotoAvatarDetails(avatarId: string): Promise<any> {
    try {
      const response = await this.apiClient.get<any>(
        `/photo_avatar/${avatarId}`
      );

      // Handle different response formats
      if (response.data.error && response.data.error !== null && typeof response.data.error === 'object') {
        throw new Error(response.data.error.message || 'Failed to get avatar details');
      }

      if (response.data.code !== undefined && response.data.code !== 100) {
        throw new Error(response.data.msg || 'Failed to get avatar details');
      }

      // Extract data from different possible locations
      return response.data.data || response.data;
    } catch (error: any) {
      if (error.response) {
        this.logger.error(
          `HeyGen API error response: Status ${error.response.status}, Data: ${JSON.stringify(error.response.data)}`,
          error.stack
        );
        throw new Error(`HeyGen get details failed: ${error.response.data?.error?.message || error.response.data?.msg || error.message}`);
      }
      this.logger.error(`Failed to get avatar details: ${error.message}`, error.stack);
      throw new Error(`HeyGen get details failed: ${error.message}`);
    }
  }

  /**
   * Poll avatar status until it's completed
   * @param avatarId HeyGen avatar ID
   * @param maxAttempts Maximum polling attempts (default: 60 = 5 minutes)
   * @param intervalMs Polling interval in milliseconds (default: 5000 = 5 seconds)
   */
  async pollAvatarStatus(avatarId: string, maxAttempts: number = 60, intervalMs: number = 5000): Promise<void> {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const details = await this.getPhotoAvatarDetails(avatarId);
        const status = details.status || details.avatar_status || details.avatarStatus;
        
        this.logger.debug(`Avatar ${avatarId} status check ${attempts}/${maxAttempts}: ${status}`);
        
        // Check if avatar is completed
        // Status might be: "pending", "processing", "completed", "ready", "done", etc.
        if (status === 'completed' || status === 'ready' || status === 'done' || status === 'success') {
          this.logger.log(`Avatar ${avatarId} is ready for motion`);
          return;
        }
        
        // If failed, throw error
        if (status === 'failed' || status === 'error') {
          throw new Error(`Avatar generation failed with status: ${status}`);
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        
      } catch (error: any) {
        // If it's a polling error (not a status check error), throw
        if (error.message.includes('Avatar generation failed')) {
          throw error;
        }
        
        // For other errors, continue polling (might be temporary network issues)
        this.logger.warn(`Status check attempt ${attempts} failed: ${error.message}`);
        
        if (attempts >= maxAttempts) {
          throw new Error(`Avatar ${avatarId} did not complete within ${maxAttempts * intervalMs / 1000} seconds`);
        }
        
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    
    throw new Error(`Avatar ${avatarId} did not complete within ${maxAttempts * intervalMs / 1000} seconds`);
  }

  /**
   * Poll motion avatar status until it's completed
   * @param motionAvatarId HeyGen motion avatar ID (returned from addMotion)
   * @param maxAttempts Maximum polling attempts (default: 120 = 10 minutes)
   * @param intervalMs Polling interval in milliseconds (default: 5000 = 5 seconds)
   * @returns Avatar details when motion generation is complete
   */
  async pollMotionAvatarStatus(motionAvatarId: string, maxAttempts: number = 120, intervalMs: number = 5000): Promise<any> {
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      attempts++;
      
      try {
        const details = await this.getPhotoAvatarDetails(motionAvatarId);
        const status = details.status || details.avatar_status || details.avatarStatus;
        
        this.logger.debug(`Motion avatar ${motionAvatarId} status check ${attempts}/${maxAttempts}: ${status}`);
        
        // Check if motion avatar is completed
        // Status might be: "pending", "processing", "completed", "ready", "done", etc.
        if (status === 'completed' || status === 'ready' || status === 'done' || status === 'success') {
          this.logger.log(`Motion avatar ${motionAvatarId} is ready`);
          return details;
        }
        
        // If failed, throw error
        if (status === 'failed' || status === 'error') {
          throw new Error(`Motion generation failed with status: ${status}`);
        }
        
        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, intervalMs));
        
      } catch (error: any) {
        // If it's a polling error (not a status check error), throw
        if (error.message.includes('Motion generation failed')) {
          throw error;
        }
        
        // For other errors, continue polling (might be temporary network issues)
        this.logger.warn(`Motion status check attempt ${attempts} failed: ${error.message}`);
        
        if (attempts >= maxAttempts) {
          throw new Error(`Motion avatar ${motionAvatarId} did not complete within ${maxAttempts * intervalMs / 1000} seconds`);
        }
        
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }
    
    throw new Error(`Motion avatar ${motionAvatarId} did not complete within ${maxAttempts * intervalMs / 1000} seconds`);
  }
}

