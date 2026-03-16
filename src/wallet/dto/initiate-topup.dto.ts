import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiateTopupDto {
  @ApiProperty({ example: 'TUP-1710000000000-ABC123EF', description: 'Topup ID returned from POST /wallet/topup' })
  @IsString()
  topup_id: string;
}