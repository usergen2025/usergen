module.exports = {
  apps: [
    {
      name: 'swagger-aggregator-service',
      script: './microservices/swagger-aggregator-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/swagger-error.log',
      out_file: './logs/swagger-out.log'
    },
    {
      name: 'auth-service',
      script: './microservices/auth-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/auth-service-error.log',
      out_file: './logs/auth-service-out.log'
    },
    {
      name: 'ai-content-service',
      script: './microservices/ai-content-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/ai-content-service-error.log',
      out_file: './logs/ai-content-service-out.log'
    },
    {
      name: 'voice-audio-service',
      script: './microservices/voice-audio-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/voice-audio-service-error.log',
      out_file: './logs/voice-audio-service-out.log'
    },
    {
      name: 'activity-service',
      script: './microservices/activity-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/activity-service-error.log',
      out_file: './logs/activity-service-out.log'
    },
    {
      name: 'video-processing-service',
      script: './microservices/video-processing-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: 'development' },
      error_file: './logs/video-processing-service-error.log',
      out_file: './logs/video-processing-service-out.log'
    },
    {
      name: 'payment-wallet-service',
      script: './microservices/payment-wallet-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/payment-wallet-service-error.log',
      out_file: './logs/payment-wallet-service-out.log'
    },
    {
      name: 'campaign-service',
      script: './microservices/campaign-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/campaign-service-error.log',
      out_file: './logs/campaign-service-out.log'
    },
    {
      name: 'notification-service',
      script: './microservices/notification-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/notification-service-error.log',
      out_file: './logs/notification-service-out.log'
    },
    {
      name: 'workspace-service',
      script: './microservices/workspace-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/workspace-service-error.log',
      out_file: './logs/workspace-service-out.log'
    },
    {
      name: 'project-management-service',
      script: './microservices/project-management-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/project-management-service-error.log',
      out_file: './logs/project-management-service-out.log'
    },
    {
      name: 'analytics-service',
      script: './microservices/analytics-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/analytics-service-error.log',
      out_file: './logs/analytics-service-out.log'
    },
    {
      name: 'media-management-service',
      script: './microservices/media-management-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/media-management-service-error.log',
      out_file: './logs/media-management-service-out.log'
    },
    {
      name: 'iam-service',
      script: './microservices/iam-service/dist/main.js',
      cwd: process.cwd(),
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '300M',
      env: { NODE_ENV: 'development' },
      error_file: './logs/iam-service-error.log',
      out_file: './logs/iam-service-out.log'
    },
    {
      name: 'client',
      script: 'npm',
      args: 'start',
      cwd: '../client',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '500M',
      env: {
        NODE_ENV: 'production',
        PORT: 3200
      },
      error_file: './logs/client-error.log',
      out_file: './logs/client-out.log'
    }
  ]
};

