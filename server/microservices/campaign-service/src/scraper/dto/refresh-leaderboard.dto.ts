import { IsBoolean, IsOptional } from 'class-validator';

export class RefreshLeaderboardDto {
  @IsOptional()
  @IsBoolean()
  force?: boolean;
}
