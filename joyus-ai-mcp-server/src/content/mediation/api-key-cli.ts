#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import 'dotenv/config';

import type { ContentApiKey } from '../schema.js';

import { ApiKeyService, type CreateKeyInput, type RevokeKeyResult } from './keys.js';

export interface ApiKeyCommandService {
  createKey(
    tenantId: string,
    input: CreateKeyInput
  ): Promise<{ key: string; id: string; keyPrefix?: string }>;
  listKeys(tenantId: string): Promise<ContentApiKey[]>;
  revokeKey(keyId: string): Promise<RevokeKeyResult>;
}

export interface CommandIo {
  stdout(message: string): void;
  stderr(message: string): void;
}

export interface CommandServiceHandle {
  service: ApiKeyCommandService;
  close?: () => Promise<void>;
}

export interface CommandRuntime {
  io?: CommandIo;
  service?: ApiKeyCommandService;
  createService?: () => Promise<CommandServiceHandle>;
}

type ParsedCommand =
  | {
      command: 'create';
      tenantId: string;
      integrationName: string;
      jwksUri: string;
      issuer?: string;
      audience?: string;
    }
  | { command: 'list'; tenantId: string }
  | { command: 'revoke'; keyId: string };

type ParseResult =
  | { ok: true; value: ParsedCommand }
  | { ok: false; message: string; exitCode: number };

const usage = `Usage:
  npm run mediation-api-keys -- create --tenant-id <tenant> --integration-name <name> --jwks-uri <uri> [--issuer <iss>] [--audience <aud>]
  npm run mediation-api-keys -- list --tenant-id <tenant>
  npm run mediation-api-keys -- revoke --key-id <key>

Commands:
  create   Create a mediation API key and print the raw key once.
  list     List safe mediation API key metadata for a tenant.
  revoke   Revoke a mediation API key by key ID.

Environment:
  DATABASE_URL must point to the Joyus MCP database for create/list/revoke.`;

const defaultIo: CommandIo = {
  stdout: message => console.log(message),
  stderr: message => console.error(message),
};

function parseOptions(tokens: string[]): { options: Map<string, string>; error?: string } {
  const options = new Map<string, string>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token.startsWith('--')) {
      return { options, error: `Unexpected positional argument: ${token}` };
    }

    const optionText = token.slice(2);
    const separatorIndex = optionText.indexOf('=');
    let name = optionText;
    let value: string | undefined;

    if (separatorIndex >= 0) {
      name = optionText.slice(0, separatorIndex);
      value = optionText.slice(separatorIndex + 1);
    } else {
      value = tokens[index + 1];
      if (value === undefined || value.startsWith('--')) {
        return { options, error: `Missing value for --${name}` };
      }
      index += 1;
    }

    if (!name) {
      return { options, error: 'Empty option name' };
    }

    if (options.has(name)) {
      return { options, error: `Duplicate option: --${name}` };
    }

    options.set(name, value);
  }

  return { options };
}

function optionValue(options: Map<string, string>, name: string): string | undefined {
  const value = options.get(name)?.trim();
  return value && value.length > 0 ? value : undefined;
}

function validateAllowedOptions(
  options: Map<string, string>,
  allowedOptions: readonly string[]
): string | undefined {
  for (const name of options.keys()) {
    if (!allowedOptions.includes(name)) {
      return `Unknown option for command: --${name}`;
    }
  }
  return undefined;
}

function requireOption(options: Map<string, string>, name: string): string | ParseResult {
  const value = optionValue(options, name);
  if (!value) {
    return {
      ok: false,
      message: `Missing required option: --${name}`,
      exitCode: 1,
    };
  }
  return value;
}

function requireUrl(value: string, optionName: string): ParseResult | undefined {
  try {
    new URL(value);
    return undefined;
  } catch {
    return {
      ok: false,
      message: `Invalid URL for --${optionName}: ${value}`,
      exitCode: 1,
    };
  }
}

export function parseMediationApiKeyCommand(args: string[]): ParseResult {
  const [command, ...optionTokens] = args;

  if (!command) {
    return { ok: false, message: usage, exitCode: 1 };
  }

  if (command === '--help' || command === '-h' || command === 'help') {
    return { ok: false, message: usage, exitCode: 0 };
  }

  if (optionTokens.includes('--help') || optionTokens.includes('-h')) {
    return { ok: false, message: usage, exitCode: 0 };
  }

  const { options, error } = parseOptions(optionTokens);
  if (error) {
    return { ok: false, message: error, exitCode: 1 };
  }

  if (command === 'create') {
    const allowedError = validateAllowedOptions(options, [
      'tenant-id',
      'integration-name',
      'jwks-uri',
      'issuer',
      'audience',
    ]);
    if (allowedError) {
      return { ok: false, message: allowedError, exitCode: 1 };
    }

    const tenantId = requireOption(options, 'tenant-id');
    if (typeof tenantId !== 'string') return tenantId;

    const integrationName = requireOption(options, 'integration-name');
    if (typeof integrationName !== 'string') return integrationName;

    const jwksUri = requireOption(options, 'jwks-uri');
    if (typeof jwksUri !== 'string') return jwksUri;

    const urlError = requireUrl(jwksUri, 'jwks-uri');
    if (urlError) return urlError;

    return {
      ok: true,
      value: {
        command,
        tenantId,
        integrationName,
        jwksUri,
        issuer: optionValue(options, 'issuer'),
        audience: optionValue(options, 'audience'),
      },
    };
  }

  if (command === 'list') {
    const allowedError = validateAllowedOptions(options, ['tenant-id']);
    if (allowedError) {
      return { ok: false, message: allowedError, exitCode: 1 };
    }

    const tenantId = requireOption(options, 'tenant-id');
    if (typeof tenantId !== 'string') return tenantId;

    return { ok: true, value: { command, tenantId } };
  }

  if (command === 'revoke') {
    const allowedError = validateAllowedOptions(options, ['key-id']);
    if (allowedError) {
      return { ok: false, message: allowedError, exitCode: 1 };
    }

    const keyId = requireOption(options, 'key-id');
    if (typeof keyId !== 'string') return keyId;

    return { ok: true, value: { command, keyId } };
  }

  return { ok: false, message: `Unknown command: ${command}\n\n${usage}`, exitCode: 1 };
}

function optionalValue(value: string | null | undefined): string {
  return value && value.length > 0 ? value : '(not set)';
}

function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '(never)';
  return value instanceof Date ? value.toISOString() : value;
}

function renderKeyMetadata(key: ContentApiKey): string[] {
  return [
    `Key ID: ${key.id}`,
    `Key prefix: ${key.keyPrefix}`,
    `Integration: ${key.integrationName}`,
    `JWKS URI: ${optionalValue(key.jwksUri)}`,
    `Issuer: ${optionalValue(key.issuer)}`,
    `Audience: ${optionalValue(key.audience)}`,
    `Active: ${key.isActive ? 'yes' : 'no'}`,
    `Created: ${formatDate(key.createdAt)}`,
    `Last used: ${formatDate(key.lastUsedAt)}`,
  ];
}

async function createKey(
  command: Extract<ParsedCommand, { command: 'create' }>,
  service: ApiKeyCommandService,
  io: CommandIo
): Promise<number> {
  const result = await service.createKey(command.tenantId, {
    integrationName: command.integrationName,
    jwksUri: command.jwksUri,
    issuer: command.issuer,
    audience: command.audience,
  });
  const keyPrefix = result.keyPrefix ?? result.key.substring(0, 8);

  io.stdout(
    [
      'Mediation API key created.',
      `Key ID: ${result.id}`,
      `Key prefix: ${keyPrefix}`,
      `Tenant ID: ${command.tenantId}`,
      `Integration: ${command.integrationName}`,
      `JWKS URI: ${command.jwksUri}`,
      `Issuer: ${optionalValue(command.issuer)}`,
      `Audience: ${optionalValue(command.audience)}`,
      '',
      'Raw API key (shown once):',
      result.key,
      '',
      'Store this value now. It cannot be recovered from the database.',
    ].join('\n')
  );

  return 0;
}

async function listKeys(
  command: Extract<ParsedCommand, { command: 'list' }>,
  service: ApiKeyCommandService,
  io: CommandIo
): Promise<number> {
  const keys = await service.listKeys(command.tenantId);

  if (keys.length === 0) {
    io.stdout(`No mediation API keys found for tenant ${command.tenantId}.`);
    return 0;
  }

  io.stdout(
    [
      `Mediation API keys for tenant ${command.tenantId}:`,
      '',
      ...keys.flatMap((key, index) => [
        `${index + 1}.`,
        ...renderKeyMetadata(key).map(line => `   ${line}`),
        '',
      ]),
    ]
      .join('\n')
      .trimEnd()
  );

  return 0;
}

async function revokeKey(
  command: Extract<ParsedCommand, { command: 'revoke' }>,
  service: ApiKeyCommandService,
  io: CommandIo
): Promise<number> {
  const result = await service.revokeKey(command.keyId);

  if (result.status === 'not_found') {
    io.stderr(`No mediation API key found for key ID ${command.keyId}.`);
    return 1;
  }

  if (result.status === 'already_revoked') {
    io.stdout(
      ['Mediation API key is already revoked.', ...renderKeyMetadata(result.key)].join('\n')
    );
    return 0;
  }

  io.stdout(['Mediation API key revoked.', ...renderKeyMetadata(result.key)].join('\n'));
  return 0;
}

async function createDefaultService(): Promise<CommandServiceHandle> {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to manage mediation API keys.');
  }

  const { db, closeDb } = await import('../../db/client.js');
  return { service: new ApiKeyService(db), close: closeDb };
}

export async function runMediationApiKeyCommand(
  args: string[],
  runtime: CommandRuntime = {}
): Promise<number> {
  const io = runtime.io ?? defaultIo;
  const parsed = parseMediationApiKeyCommand(args);

  if (!parsed.ok) {
    const writer = parsed.exitCode === 0 ? io.stdout : io.stderr;
    writer(parsed.message);
    return parsed.exitCode;
  }

  let handle: CommandServiceHandle | undefined;

  try {
    handle = runtime.service
      ? { service: runtime.service }
      : await (runtime.createService ?? createDefaultService)();

    if (parsed.value.command === 'create') {
      return await createKey(parsed.value, handle.service, io);
    }

    if (parsed.value.command === 'list') {
      return await listKeys(parsed.value, handle.service, io);
    }

    return await revokeKey(parsed.value, handle.service, io);
  } catch (error) {
    io.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await handle?.close?.();
  }
}

function isEntrypoint(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isEntrypoint()) {
  runMediationApiKeyCommand(process.argv.slice(2)).then(exitCode => {
    process.exitCode = exitCode;
  });
}
