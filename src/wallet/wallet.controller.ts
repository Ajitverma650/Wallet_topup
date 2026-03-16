import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { WalletService }    from './wallet.service';
import { CreateTopupDto }   from './dto/create-topup.dto';
import { InitiateTopupDto } from './dto/initiate-topup.dto';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  // POST /wallet/topup
  @Post('topup')
  createTopup(@Body() dto: CreateTopupDto) {
    return this.walletService.createTopup(dto);
  }

  // POST /wallet/topup/initiate
  @Post('topup/initiate')
  initiateTopup(@Body() dto: InitiateTopupDto) {
    return this.walletService.initiateTopup(dto);
  }

  // GET /wallet/:user_id
  @Get(':user_id')
  getBalance(@Param('user_id') userId: string) {
    return this.walletService.getBalance(userId);
  }

  // GET /wallet/topup/:topup_id
  @Get('topup/:topup_id')
  getTopupStatus(@Param('topup_id') topupId: string) {
    return this.walletService.getTopupStatus(topupId);
  }
}