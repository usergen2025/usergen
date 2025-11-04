import { Injectable, Logger } from '@nestjs/common';
import { EmailService } from '../email/email.service';

export interface SendOTPDto {
  email: string;
  mobile?: string;
  otp: string;
  type: 'EMAIL_VERIFICATION' | 'LOGIN' | 'PASSWORD_RESET';
}

export interface SendEmailDto {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private emailService: EmailService) {}

  async sendOTP(sendOTPDto: SendOTPDto): Promise<void> {
    const { email, otp, type } = sendOTPDto;

    this.logger.log(`📧 Sending OTP to ${email} (type: ${type})`);

    try {
      // Send OTP via email
      await this.emailService.sendOTP(email, otp, type);
      this.logger.log(`✅ OTP sent successfully to ${email}`);

      // TODO: Send OTP via SMS when SMS service is implemented
      // if (sendOTPDto.mobile) {
      //   await this.smsService.sendOTP(sendOTPDto.mobile, otp, type);
      // }
    } catch (error) {
      this.logger.error(`❌ Failed to send OTP to ${email}:`, error);
      throw error;
    }
  }

  async sendEmail(sendEmailDto: SendEmailDto): Promise<void> {
    const { to, subject, html, text } = sendEmailDto;

    this.logger.log(`📧 Sending email to ${to} with subject: ${subject}`);

    try {
      await this.emailService.sendEmail(to, subject, html, text);
      this.logger.log(`✅ Email sent successfully to ${to}`);
    } catch (error) {
      this.logger.error(`❌ Failed to send email to ${to}:`, error);
      throw error;
    }
  }
}

