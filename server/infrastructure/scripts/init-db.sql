-- Initialize databases for UserGen.ai microservices
-- This script creates separate databases for each service

-- Create databases
CREATE DATABASE usergen_auth;
CREATE DATABASE usergen_iam;
CREATE DATABASE usergen_workspaces;
CREATE DATABASE usergen_payments;
CREATE DATABASE usergen_activities;
CREATE DATABASE usergen_ai_content;
CREATE DATABASE usergen_voice_audio;
CREATE DATABASE usergen_media_management;
CREATE DATABASE usergen_video_processing;
CREATE DATABASE usergen_payment_wallet;
CREATE DATABASE usergen_notification;
CREATE DATABASE usergen_project_management;
CREATE DATABASE usergen_analytics;

-- Create users for each service
CREATE USER usergen_auth_user WITH PASSWORD 'password';
CREATE USER usergen_iam_user WITH PASSWORD 'password';
CREATE USER usergen_workspaces_user WITH PASSWORD 'password';
CREATE USER usergen_payments_user WITH PASSWORD 'password';
CREATE USER usergen_activities_user WITH PASSWORD 'password';
CREATE USER usergen_ai_content_user WITH PASSWORD 'password';
CREATE USER usergen_voice_audio_user WITH PASSWORD 'password';
CREATE USER usergen_media_management_user WITH PASSWORD 'password';
CREATE USER usergen_video_processing_user WITH PASSWORD 'password';
CREATE USER usergen_payment_wallet_user WITH PASSWORD 'password';
CREATE USER usergen_notification_user WITH PASSWORD 'password';
CREATE USER usergen_project_management_user WITH PASSWORD 'password';
CREATE USER usergen_analytics_user WITH PASSWORD 'password';

-- Grant permissions
GRANT ALL PRIVILEGES ON DATABASE usergen_auth TO usergen_auth_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_iam TO usergen_iam_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_workspaces TO usergen_workspaces_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_payments TO usergen_payments_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_activities TO usergen_activities_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_ai_content TO usergen_ai_content_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_voice_audio TO usergen_voice_audio_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_media_management TO usergen_media_management_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_video_processing TO usergen_video_processing_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_payment_wallet TO usergen_payment_wallet_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_notification TO usergen_notification_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_project_management TO usergen_project_management_user;
GRANT ALL PRIVILEGES ON DATABASE usergen_analytics TO usergen_analytics_user;

-- Create extensions for each database
\c usergen_auth;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_iam;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_workspaces;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_payments;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_activities;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_ai_content;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_voice_audio;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_media_management;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_video_processing;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_payment_wallet;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_notification;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_project_management;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

\c usergen_analytics;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
