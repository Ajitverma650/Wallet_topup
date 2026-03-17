import { IsString, IsNotEmpty, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiateTopupDto {
  @ApiProperty({ example: 'TUP-1710000000000-ABC123EF', description: 'Topup ID from POST /wallet/topup' })
  @IsString()
  @IsNotEmpty({ message: 'topup_id should not be empty' })
  @Matches(/^TUP-\d+-[A-F0-9]+$/, {
    message: 'topup_id must be a valid TUP-timestamp-random format',
  })
  topup_id: string;
}