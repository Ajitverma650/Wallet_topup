import { IsString } from 'class-validator';

export class InitiateTopupDto {
  @IsString()
  topup_id: string;
}