import type { NextFunction, Request, Response } from 'express';

const CLIENT_PARSER_ERRORS = new Map<string, number>([
  ['entity.parse.failed', 400], ['entity.too.large', 413],
  ['querystring.parse.rangeError', 400], ['parameters.too.many', 413],
  ['request.aborted', 400], ['request.size.invalid', 400],
  ['charset.unsupported', 415], ['encoding.unsupported', 415],
]);

/** Mounted after every global body parser, before the logger can inspect raw MCP input. */
export function mcpJsonBodyErrorHandler(error: unknown, _req: Request, res: Response, next: NextFunction): void {
  const type = (error as { type?: unknown } | null)?.type;
  const status = typeof type === 'string' ? CLIENT_PARSER_ERRORS.get(type) : undefined;
  if (!status) { next(error); return; }
  const message = status === 413 ? 'Request too large' : status === 415 ? 'Unsupported request encoding' : 'Parse error';
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).json({
    jsonrpc: '2.0', id: null,
    error: { code: status === 400 ? -32700 : -32600, message },
  });
}
