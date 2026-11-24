import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readWalletQuery, walletProofMaximumBytes } from '@playsport/shared';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { WalletService, type WalletProofUpload } from './wallet.service';
@Controller('wallet')
export class WalletController {
  private readonly wallet: WalletService;
  constructor(wallet: WalletService) { this.wallet = wallet; }
  @Get()
  read(@Query() query: Record<string, unknown>, @Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    let parsed;
    try { parsed = readWalletQuery(Object.entries(query)); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'La consulta de la billetera no es válida.'); }
    return this.wallet.read(accountToken(request), parsed.before, parsed.beforeRecharge, parsed.beforeReview);
  }
  @Post()
  recharge(@Body() body: unknown, @Query() query: Record<string, unknown>, @Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store'); assertAccountOrigin(request);
    if (Object.keys(query).length) throw new BadRequestException('La operación no admite parámetros en la URL.');
    if (body && typeof body === 'object' && 'kind' in body && body.kind === 'review-recharge') return this.wallet.review(accountToken(request), body);
    return this.wallet.recharge(accountToken(request), body, true);
  }
  @Post('recharges')
  @UseInterceptors(FileInterceptor('proof', { limits: { fileSize: walletProofMaximumBytes, files: 1, fields: 1, fieldSize: 4096 } }))
  submit(@Body() body: Record<string, unknown>, @UploadedFile() proof: WalletProofUpload | undefined,
    @Query() query: Record<string, unknown>, @Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store'); assertAccountOrigin(request);
    if (Object.keys(query).length) throw new BadRequestException('La operación no admite parámetros en la URL.');
    if (Object.keys(body).some(key => key !== 'input') || typeof body.input !== 'string') throw new BadRequestException('Envía únicamente los datos de la solicitud y su comprobante.');
    let input: unknown;
    try { input = JSON.parse(body.input); }
    catch { throw new BadRequestException('Los datos de la solicitud no son JSON válido.'); }
    return this.wallet.submit(accountToken(request), input, proof);
  }
  @Get('recharges/:id/proof')
  proof(@Param('id') id: string, @Query() query: Record<string, unknown>, @Req() request: IncomingMessage, @Res() response: ServerResponse) {
    if (!/^[1-9]\d*$/.test(id) || Object.keys(query).length) throw new BadRequestException('La consulta del comprobante no es válida.');
    const proof = this.wallet.proof(accountToken(request), Number(id));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Content-Type', proof.type);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Disposition', `attachment; filename="comprobante-${id}"; filename*=UTF-8''${encodeURIComponent(proof.name)}`);
    response.end(proof.buffer);
  }
}
