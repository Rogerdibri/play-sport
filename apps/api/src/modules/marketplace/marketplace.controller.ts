import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readMarketplaceQuery, type MarketplaceQuery } from '@playsport/shared';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { MarketplaceService } from './marketplace.service';

@Controller('marketplace')
export class MarketplaceController {
  private readonly marketplace: MarketplaceService;
  constructor(marketplace: MarketplaceService) { this.marketplace = marketplace; }
  @Get('photos/:filename')
  photo(@Param('filename') filename: string, @Res() response: ServerResponse) {
    const bytes = this.marketplace.readPhoto(filename);
    response.setHeader('Content-Type', 'image/jpeg');
    response.setHeader('Content-Length', bytes.length);
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.end(bytes);
  }
  @Get()
  read(@Query() query: Record<string, unknown>, @Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    let parsed: MarketplaceQuery;
    try { parsed = readMarketplaceQuery(Object.entries(query)); }
    catch (error) { throw new BadRequestException(error instanceof Error ? error.message : 'La consulta del Marketplace no es válida.'); }
    return this.marketplace.read(accountToken(request), parsed);
  }
  @Post()
  perform(@Body() body: unknown, @Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store'); assertAccountOrigin(request);
    return this.marketplace.perform(accountToken(request), body);
  }
}
