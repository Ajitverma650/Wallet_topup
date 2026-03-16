import { IsString, IsNumber, IsPositive } from 'class-validator';

export class CreateTopupDto {
  @IsString()
  user_id: string;

  @IsNumber()
  @IsPositive()
  amount: number;
}