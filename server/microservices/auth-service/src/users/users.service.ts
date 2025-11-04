import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../common/database/database.service';
import { ResponseHelper } from '@shared/utils';

@Injectable()
export class UsersService {
  constructor(private readonly databaseService: DatabaseService) {}

  async findById(id: string) {
    const user = await this.databaseService.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        mobile: true,
        socialMediaLink: true,
        goal: true,
        profilePicture: true,
        credits: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        isMobileVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async findByEmail(email: string) {
    const user = await this.databaseService.user.findUnique({
      where: { email },
    });

    return user;
  }

  async updateProfile(id: string, updateData: any) {
    const user = await this.databaseService.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        mobile: true,
        socialMediaLink: true,
        goal: true,
        profilePicture: true,
        credits: true,
        role: true,
        isActive: true,
        isEmailVerified: true,
        isMobileVerified: true,
        lastLoginAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return user;
  }

  async updateCredits(id: string, credits: number) {
    const user = await this.databaseService.user.update({
      where: { id },
      data: { credits },
      select: {
        id: true,
        email: true,
        credits: true,
      },
    });

    return user;
  }

  async deactivateUser(id: string) {
    const user = await this.databaseService.user.update({
      where: { id },
      data: { isActive: false },
    });

    return user;
  }
}
