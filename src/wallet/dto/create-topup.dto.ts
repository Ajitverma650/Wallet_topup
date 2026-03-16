import { IsString, IsNumber, IsPositive, Matches, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTopupDto {

  @ApiProperty({ example: 'U123', description: 'Unique user identifier (alphanumeric, 1–50 chars)' })
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{1,50}$/, {
    message: 'user_id must be 1–50 alphanumeric characters (letters, digits, _ or -)',
  })
  user_id: string;

  @ApiProperty({ example: 500.00, description: 'Top-up amount in INR (min 0.01, max 100,000)' })
  @IsNumber()
  @IsPositive()
  @Min(0.01, { message: 'Amount must be at least 0.01' })
  @Max(100_000, { message: 'Amount cannot exceed 100,000 per topup' })
  amount: number;
}
