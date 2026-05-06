#!/usr/bin/env node

import {
  createPublicKey,
  createSign,
  generateKeyPairSync,
  randomUUID,
} from 'node:crypto';
import { createServer } from 'node:http';

const DEFAULT_PORT = 3999;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_SUBJECT = 'local-user-1';
const DEFAULT_TTL_SECONDS = 24 * 60 * 60;

function readOption(name, fallback) {
  const arg = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return arg.slice(name.length + 3);
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function printHelp() {
  console.log(`
Usage:
  npm run dev:mediation-auth
  node scripts/mediation-dev-auth.mjs --port=3999 --sub=local-user-1

Options:
  --host=<host>       Host to bind. Default: ${DEFAULT_HOST}
  --port=<port>       Port to bind. Default: ${DEFAULT_PORT}
  --sub=<subject>     JWT subject/user id. Default: ${DEFAULT_SUBJECT}
  --issuer=<issuer>   JWT issuer. Default: http://<host>:<port>
  --audience=<aud>    Optional JWT audience.
  --ttl=<seconds>     JWT lifetime. Default: ${DEFAULT_TTL_SECONDS}
  --help              Show this help.
`);
}

function base64Url(input) {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function signJwt({ privateKey, kid, issuer, subject, audience, ttlSeconds }) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = {
    alg: 'RS256',
    typ: 'JWT',
    kid,
  };
  const payload = {
    iss: issuer,
    sub: subject,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };

  if (audience) {
    payload.aud = audience;
  }

  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).end().sign(privateKey);

  return `${signingInput}.${base64Url(signature)}`;
}

if (hasFlag('help')) {
  printHelp();
  process.exit(0);
}

const host = readOption('host', DEFAULT_HOST);
const port = Number.parseInt(readOption('port', String(DEFAULT_PORT)), 10);
const subject = readOption('sub', DEFAULT_SUBJECT);
const issuer = readOption('issuer', `http://${host}:${port}`);
const audience = readOption('audience', '');
const ttlSeconds = Number.parseInt(readOption('ttl', String(DEFAULT_TTL_SECONDS)), 10);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error('Invalid --port value.');
  process.exit(1);
}

if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
  console.error('Invalid --ttl value.');
  process.exit(1);
}

const kid = randomUUID();
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const publicJwk = {
  ...createPublicKey(publicKey).export({ format: 'jwk' }),
  kid,
  use: 'sig',
  alg: 'RS256',
};
const jwks = { keys: [publicJwk] };
const jwt = signJwt({
  privateKey,
  kid,
  issuer,
  subject,
  audience,
  ttlSeconds,
});
const jwksUri = `${issuer}/.well-known/jwks.json`;

const server = createServer((req, res) => {
  if (req.url === '/.well-known/jwks.json') {
    res.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(jwks));
    return;
  }

  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

server.on('error', (error) => {
  console.error(`Failed to start local mediation dev auth server: ${error.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log('Local mediation dev auth server running.');
  console.log('');
  console.log(`JWKS: ${jwksUri}`);
  console.log(`Subject: ${subject}`);
  console.log(`Issuer: ${issuer}`);
  if (audience) console.log(`Audience: ${audience}`);
  console.log('');
  console.log('Paste these exports into the shell where you run curl/psql:');
  console.log('');
  console.log(`export JWKS_URI="${jwksUri}"`);
  console.log(`export USER_JWT="${jwt}"`);
  console.log('');
  console.log('Keep this process running while testing /api/mediation.');
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
