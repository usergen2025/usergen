# Email Configuration Setup Guide

## Gmail SMTP Setup

To send emails using your Gmail account, you need to:

### 1. Enable 2-Factor Authentication
- Go to your Google Account settings: https://myaccount.google.com/
- Navigate to Security
- Enable 2-Step Verification

### 2. Generate App Password
- After enabling 2FA, go to: https://myaccount.google.com/apppasswords
- Select "Mail" and "Other (Custom name)"
- Enter "UserGen.ai" as the app name
- Click "Generate"
- Copy the 16-character password (you'll need this for `SMTP_PASS`)

### 3. Configure Environment Variables

Add the following to your `server/.env` file (or `server/environments/local/.env.local`):

```env
# Notification Service Configuration
NOTIFICATION_SERVICE_URL=http://localhost:9006/api

# Email Configuration (Gmail SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
FROM_EMAIL=your-email@gmail.com
APP_NAME=UserGen.ai
```

### 4. Update Notification Service Environment

Also add the same email configuration to `server/microservices/notification-service/.env`:

```env
NODE_ENV=local
SERVICE_NAME=notification-service
SERVICE_PORT=9006
CORS_ORIGINS=http://localhost:3200,http://localhost:9000

# App Configuration
APP_NAME=UserGen.ai

# Email Configuration (Gmail SMTP)
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-16-char-app-password
FROM_EMAIL=your-email@gmail.com
```

### 5. Start Services

Make sure both services are running:
- Notification Service (port 9006)
- Auth Service (port 9000)

```bash
# From server directory
npm run dev:notification
npm run dev:auth
```

### Testing

Once configured, test by sending an OTP from the frontend. The email should be delivered to the user's inbox.

## Troubleshooting

### Error: Invalid login credentials
- Make sure you're using the App Password, not your regular Gmail password
- Verify 2FA is enabled on your Google account

### Error: Connection timeout
- Check your firewall settings
- Verify SMTP_PORT=587 is correct
- Some networks block SMTP, try from a different network

### Email not received
- Check spam folder
- Verify FROM_EMAIL matches SMTP_USER
- Check notification service logs for errors

