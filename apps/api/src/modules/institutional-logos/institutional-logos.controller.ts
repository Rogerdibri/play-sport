import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readInstitutionId, readInstitutionKind } from '@playsport/shared';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { InstitutionalLogosService } from './institutional-logos.service';
@Controller('institutional-logos')
export class InstitutionalLogosController {
  private readonly logos: InstitutionalLogosService;
  constructor(logos: InstitutionalLogosService) {
    this.logos = logos;
  }
  private query(query: Record<string, unknown>, fields: string[]) {
    if (Object.keys(query).some((key) => !fields.includes(key)))
      throw new BadRequestException('La consulta de logos contiene parámetros desconocidos.');
  }
  @Get()
  list(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) response: ServerResponse) {
    this.query(query, []);
    response.setHeader('Cache-Control', 'no-store');
    return { entities: this.logos.list() };
  }
  @Get('manage')
  manageable(
    @Query() query: Record<string, unknown>,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse
  ) {
    this.query(query, ['role', 'actorId']);
    response.setHeader('Cache-Control', 'no-store');
    return this.logos.manageable(accountToken(request), query.role, query.actorId);
  }
  @Get('image')
  image(@Query() query: Record<string, unknown>, @Res() response: ServerResponse, @Req() request: IncomingMessage) {
    this.query(query, ['kind', 'id', 'revision']);
    let kind, id;
    try {
      kind = readInstitutionKind(query.kind);
      id = readInstitutionId(query.id);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'La identidad no es válida.');
    }
    if (
      typeof query.revision !== 'string' ||
      !/^[1-9]\d*$/.test(query.revision) ||
      !Number.isSafeInteger(Number(query.revision))
    )
      throw new BadRequestException('La revisión del logo no es válida.');
    const image = this.logos.readImage(kind, id, Number(query.revision), accountToken(request));
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Type', image.type);
    response.end(image.buffer);
  }
  @Post()
  @HttpCode(200)
  change(
    @Query() query: Record<string, unknown>,
    @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse,
    @Body() body: unknown
  ) {
    this.query(query, []);
    assertAccountOrigin(request);
    response.setHeader('Cache-Control', 'no-store');
    return this.logos.change(accountToken(request), body);
  }
}
