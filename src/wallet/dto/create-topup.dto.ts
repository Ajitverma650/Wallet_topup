import { IsString, IsNumber, IsPositive, IsNotEmpty, Matches, Max, Min } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateTopupDto {

  @ApiProperty({ example: 'U123', description: 'Unique user identifier' })
  @IsString()
  @IsNotEmpty({ message: 'user_id should not be empty' })
  @Matches(/^[A-Za-z0-9_-]{1,50}$/, {
    message: 'user_id must be 1–50 alphanumeric characters',
  })
  user_id: string;

  @ApiProperty({ example: 500, description: 'Top-up amount in INR' })
  @Transform(({ value }) => Number(value))
  @IsNumber()
  @IsPositive()
  @Min(0.1, { message: 'Amount must be at least 0.1' })
  @Max(100_000, { message: 'Amount cannot exceed 100,000' })
  amount: number;
}