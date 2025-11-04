import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { Transporter } from 'nodemailer';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private transporter: Transporter;

  constructor(private configService: ConfigService) {
    this.initializeTransporter();
  }

  private initializeTransporter() {
    const smtpHost = this.configService.get<string>('SMTP_HOST', 'smtp.gmail.com');
    const smtpPort = this.configService.get<number>('SMTP_PORT', 587);
    const smtpUser = this.configService.get<string>('SMTP_USER');
    const smtpPass = this.configService.get<string>('SMTP_PASS');
    const fromEmail = this.configService.get<string>('FROM_EMAIL', smtpUser);

    if (!smtpUser || !smtpPass) {
      this.logger.warn('SMTP credentials not configured. Email sending will fail.');
      return;
    }

    this.transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: false, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass?.trim(), // Remove any whitespace from app password
      },
      tls: {
        rejectUnauthorized: false, // Allow self-signed certificates
      },
    });

    // Verify connection
    this.transporter.verify((error, success) => {
      if (error) {
        this.logger.error('SMTP connection error:', error);
      } else {
        this.logger.log('✅ SMTP server is ready to send emails');
      }
    });
  }

  async sendOTP(to: string, otp: string, type: 'EMAIL_VERIFICATION' | 'LOGIN' | 'PASSWORD_RESET'): Promise<void> {
    const fromEmail = this.configService.get<string>('FROM_EMAIL', this.configService.get<string>('SMTP_USER'));
    const appName = this.configService.get<string>('APP_NAME', 'UserGen.ai');

    let subject: string;
    let html: string;

    switch (type) {
      case 'EMAIL_VERIFICATION':
        subject = `Verify your email - ${appName}`;
        html = this.getOTPEmailTemplate(otp, 'email verification');
        break;
      case 'LOGIN':
        subject = `Your login OTP - ${appName}`;
        html = this.getOTPEmailTemplate(otp, 'login');
        break;
      case 'PASSWORD_RESET':
        subject = `Password Reset OTP - ${appName}`;
        html = this.getOTPEmailTemplate(otp, 'password reset');
        break;
      default:
        subject = `Your OTP - ${appName}`;
        html = this.getOTPEmailTemplate(otp, 'verification');
    }

    try {
      const info = await this.transporter.sendMail({
        from: `"${appName}" <${fromEmail}>`,
        to,
        subject,
        html,
      });

      this.logger.log(`✅ OTP email sent successfully to ${to}. Message ID: ${info.messageId}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send OTP email to ${to}:`, error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  async sendEmail(to: string, subject: string, html: string, text?: string): Promise<void> {
    const fromEmail = this.configService.get<string>('FROM_EMAIL', this.configService.get<string>('SMTP_USER'));
    const appName = this.configService.get<string>('APP_NAME', 'UserGen.ai');

    try {
      const info = await this.transporter.sendMail({
        from: `"${appName}" <${fromEmail}>`,
        to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
      });

      this.logger.log(`✅ Email sent successfully to ${to}. Message ID: ${info.messageId}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${to}:`, error);
      throw new Error(`Failed to send email: ${error.message}`);
    }
  }

  private getOTPEmailTemplate(otp: string, purpose: string): string {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>OTP Verification</title>
</head>
<body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
  <table role="presentation" style="width: 100%; border-collapse: collapse;">
    <tr>
      <td align="center" style="padding: 40px 0;">
        <table role="presentation" style="width: 600px; border-collapse: collapse; background-color: #ffffff; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
          <tr>
            <td style="padding: 40px 30px; text-align: center; background-color: #000000; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; color: #ffffff; font-size: 28px;">UserGen.ai</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px 30px;">
              <h2 style="margin: 0 0 20px 0; color: #333333; font-size: 24px;">OTP for ${purpose}</h2>
              <p style="margin: 0 0 30px 0; color: #666666; font-size: 16px; line-height: 1.5;">
                Use the following One-Time Password (OTP) to complete your ${purpose}:
              </p>
              <div style="text-align: center; margin: 30px 0;">
                <div style="display: inline-block; padding: 20px 40px; background-color: #f8f9fa; border: 2px dashed #dee2e6; border-radius: 8px;">
                  <p style="margin: 0; font-size: 36px; font-weight: bold; color: #000000; letter-spacing: 8px;">${otp}</p>
                </div>
              </div>
              <p style="margin: 30px 0 0 0; color: #999999; font-size: 14px; line-height: 1.5;">
                This OTP will expire in 10 minutes. Do not share this code with anyone.
              </p>
              <p style="margin: 20px 0 0 0; color: #999999; font-size: 12px; line-height: 1.5;">
                If you didn't request this OTP, please ignore this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 30px; text-align: center; background-color: #f8f9fa; border-radius: 0 0 8px 8px;">
              <p style="margin: 0; color: #999999; font-size: 12px;">
                © ${new Date().getFullYear()} UserGen.ai. All rights reserved.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;
  }
}

