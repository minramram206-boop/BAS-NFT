import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { loadServerConfig } from '../dist/index.js';

const secret = 'ab'.repeat(32);

describe('server config', () => {
  it('starts on devnet with process-local storage and chat off', () => {
    const config = loadServerConfig({ BAS_NETWORK: 'devnet', MISSION_TOKEN_SECRET: secret });
    assert.equal(config.network.cluster, 'devnet');
    assert.equal(config.chat.enabled, false);
    assert.equal(config.port, 8788);
    assert.equal(config.databaseUrl, undefined);
  });

  it('needs the shared token secret', () => {
    assert.throws(() => loadServerConfig({ BAS_NETWORK: 'devnet' }), /MISSION_TOKEN_SECRET/);
    assert.throws(() => loadServerConfig({ BAS_NETWORK: 'devnet', MISSION_TOKEN_SECRET: 'abcd' }), /MISSION_TOKEN_SECRET/);
  });

  it('refuses mainnet without Postgres and Redis', () => {
    const base = { BAS_NETWORK: 'mainnet-beta', MISSION_TOKEN_SECRET: secret };
    assert.throws(() => loadServerConfig(base), /DATABASE_URL and REDIS_URL/);
    assert.throws(() => loadServerConfig({ ...base, DATABASE_URL: 'postgres://x' }), /DATABASE_URL and REDIS_URL/);
  });

  it('refuses mainnet while its manifest holds placeholders or devnet values', () => {
    const env = { BAS_NETWORK: 'mainnet-beta', MISSION_TOKEN_SECRET: secret, DATABASE_URL: 'postgres://x', REDIS_URL: 'redis://x' };
    assert.throws(() => loadServerConfig(env), /not launch ready.*districtProgramId/);
  });

  it('reads the port and the allowed origins', () => {
    const config = loadServerConfig({
      BAS_NETWORK: 'devnet',
      MISSION_TOKEN_SECRET: secret,
      CHAT_PORT: '9000',
      ALLOWED_ORIGINS: 'http://a.example, http://b.example',
    });
    assert.equal(config.port, 9000);
    assert.deepEqual(config.allowedOrigins, ['http://a.example', 'http://b.example']);
    assert.throws(() => loadServerConfig({ BAS_NETWORK: 'devnet', MISSION_TOKEN_SECRET: secret, CHAT_PORT: 'x' }), /CHAT_PORT/);
  });
});
