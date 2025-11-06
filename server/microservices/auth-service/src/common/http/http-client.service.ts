import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios, { AxiosInstance } from 'axios';

@Injectable()
export class HttpClientService implements OnModuleInit {
  private readonly logger = new Logger(HttpClientService.name);
  private axiosInstance: AxiosInstance;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    let notificationServiceUrl = this.configService.get<string>(
      'NOTIFICATION_SERVICE_URL',
      'http://localhost:9006/api',
    );

    // Normalize URL: Remove trailing /notifications if present
    // This prevents double /notifications in the final URL
    // baseURL should be: https://api.dev.usergen.ai/api (without /notifications)
    // endpoint will be: /notifications/send-otp
    if (notificationServiceUrl.endsWith('/notifications')) {
      notificationServiceUrl = notificationServiceUrl.replace(/\/notifications$/, '');
      this.logger.warn(
        `⚠️ NOTIFICATION_SERVICE_URL ends with /notifications, removing it. Use: ${notificationServiceUrl}`,
      );
    }

    this.axiosInstance = axios.create({
      baseURL: notificationServiceUrl,
      timeout: 10000, // 10 seconds timeout
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (config) => {
        this.logger.debug(`Making request to ${config.url}`);
        return config;
      },
      (error) => {
        this.logger.error('Request error:', error);
        return Promise.reject(error);
      },
    );

    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => {
        return response;
      },
      (error) => {
        if (error.response) {
          this.logger.error(
            `Notification service error: ${error.response.status} - ${JSON.stringify(error.response.data)}`,
          );
        } else if (error.request) {
          this.logger.error(`Notification service unavailable: ${error.message}`);
        } else {
          this.logger.error(`Request setup error: ${error.message}`);
        }
        return Promise.reject(error);
      },
    );

    this.logger.log(`HTTP Client initialized with base URL: ${notificationServiceUrl}`);
  }

  get client(): AxiosInstance {
    return this.axiosInstance;
  }
}

