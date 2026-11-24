import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { accountToken, assertAccountOrigin } from '../accounts/account-http';
import { GameChatService } from './game-chat.service';

@Controller('game-chat')
export class GameChatController {
  private readonly chat: GameChatService;
  constructor(chat: GameChatService) { this.chat = chat; }
  @Get(':gameId')
  read(@Param('gameId') gameId: string, @Query('before') before: string | undefined, @Query('after') after: string | undefined,
    @Req() request: IncomingMessage, @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    return this.chat.read(gameId, accountToken(request), before === undefined ? undefined : Number(before),
      after === undefined ? undefined : Number(after));
  }
  @Post(':gameId')
  perform(@Param('gameId') gameId: string, @Body() body: unknown, @Req() request: IncomingMessage,
    @Res({ passthrough: true }) response: ServerResponse) {
    response.setHeader('Cache-Control', 'no-store');
    assertAccountOrigin(request);
    return this.chat.perform(gameId, accountToken(request), body);
  }
}
