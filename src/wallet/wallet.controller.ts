import { Controller, Post, Get, Body, Param } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiBody, ApiResponse } from '@nestjs/swagger';
import { WalletService }    from './wallet.service';
import { CreateTopupDto }   from './dto/create-topup.dto';
import { InitiateTopupDto } from './dto/initiate-topup.dto';

@ApiTags('wallet')
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  // POST /wallet/topup
  @ApiOperation({ summary: 'Create a new topup request', description: 'Creates a pending topup record for the user. Returns a topup_id to use in the next step.' })
  @ApiResponse({ status: 201, description: 'Topup created successfully' })
  @ApiResponse({ status: 400, description: 'Invalid input (bad user_id format, amount out of range)' })
  @Post('topup')
  createTopup(@Body() dto: CreateTopupDto) {
    return this.walletService.createTopup(dto);
  }

  // POST /wallet/topup/initiate
  @ApiOperation({ summary: 'Initiate the UPI payment', description: 'Generates a UPI payment link and QR code for the pending topup. Returns a transaction_id.' })
  @ApiResponse({ status: 201, description: 'Payment initiated — returns payment_link, qr_code, transaction_id' })
  @ApiResponse({ status: 404, description: 'Topup not found' })
  @ApiResponse({ status: 400, description: 'Topup already initiated or completed' })
  @Post('topup/initiate')
  initiateTopup(@Body() dto: InitiateTopupDto) {
    return this.walletService.initiateTopup(dto);
  }

  // ✅ FIX: static-prefix routes MUST come before dynamic wildcard routes
  // GET /wallet/topup/:topup_id  ← declare first
  @ApiOperation({ summary: 'Get topup status', description: 'Returns current status (pending/success/failed) and linked transaction_id for a given topup.' })
  @ApiParam({ name: 'topup_id', example: 'TXN-1710000000000-ABC123EF' })
  @ApiResponse({ status: 200, description: 'Topup status returned' })
  @ApiResponse({ status: 404, description: 'Topup not found' })
  @Get('topup/:topup_id')
  getTopupStatus(@Param('topup_id') topupId: string) {
    return this.walletService.getTopupStatus(topupId);
  }

  // GET /wallet/:user_id  ← wildcard catch-all declared last
  @ApiOperation({ summary: 'Get wallet balance', description: 'Returns current wallet balance. Served from Redis cache (60s TTL) then falls back to PostgreSQL.' })
  @ApiParam({ name: 'user_id', example: 'U123' })
  @ApiResponse({ status: 200, description: 'Returns balance and cache source (cache | database)' })
  @ApiResponse({ status: 404, description: 'Wallet not found for this user' })
  @Get(':user_id')
  getBalance(@Param('user_id') userId: string) {
    return this.walletService.getBalance(userId);
  }
}
