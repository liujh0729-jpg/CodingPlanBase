import { Body, Controller, Get, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { RelayService } from './relay.service';

/**
 * OpenAI/Anthropic 兼容转发端点。全局 JWT 守卫对 /v1 放行，
 * 这里用 sk- 令牌鉴权（网关对外契约与 new-api 一致）。
 */
@Controller('v1')
export class RelayController {
  constructor(private readonly relay: RelayService) {}

  @Get('models')
  async models(@Req() request: Request) {
    const ctx = await this.relay.authenticate(request);
    return this.relay.listModels(ctx);
  }

  @Post('chat/completions')
  chat(
    @Req() request: Request,
    @Res({ passthrough: false }) response: Response,
    @Body() body: Record<string, unknown>,
  ) {
    return this.forward(request, response, body, '/v1/chat/completions');
  }

  @Post('completions')
  completions(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: Record<string, unknown>,
  ) {
    return this.forward(request, response, body, '/v1/completions');
  }

  @Post('embeddings')
  embeddings(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: Record<string, unknown>,
  ) {
    return this.forward(request, response, body, '/v1/embeddings');
  }

  @Post('messages')
  messages(
    @Req() request: Request,
    @Res() response: Response,
    @Body() body: Record<string, unknown>,
  ) {
    return this.forward(request, response, body, '/v1/messages');
  }

  private async forward(
    request: Request,
    response: Response,
    body: Record<string, unknown>,
    path: string,
  ) {
    const ctx = await this.relay.authenticate(request);
    await this.relay.chat(
      ctx,
      body || {},
      path,
      request.headers,
      request.ip || '',
      response,
    );
  }
}
