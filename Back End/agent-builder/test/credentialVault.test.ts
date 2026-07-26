import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import type { Storage } from '../src/storage/index.ts';
import { JsonFileStorage } from '../src/storage/jsonfile.ts';
import { CredentialVaultError, VaultStorage, type VaultFailurePhase } from '../src/storage/vault.ts';

function injectCredentialPutFailure(inner: Storage, failAt: number): { storage: Storage; arm: () => void } {
  let armed = false;
  let credentialPuts = 0;
  const storage = new Proxy(inner, {
    get(target, property, receiver) {
      if (property === 'put') {
        return async (collection: string, id: string, doc: unknown, ref?: string): Promise<void> => {
          const isCredential = collection === 'mcp_servers' || (collection === 'settings' && (id === 'provider_keys' || id.startsWith('provider_keys:')));
          if (armed && isCredential && ++credentialPuts === failAt) throw new Error(`injected credential put failure ${failAt}`);
          return target.put(collection, id, doc, ref);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as Storage;
  return { storage, arm: () => { armed = true; } };
}

async function exerciseVault(name: string, make: (dir: string) => Storage): Promise<void> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-builder-vault-${name}-`));
  const raw = make(dir);
  const vault = new VaultStorage(raw, dir);
  const providerSecret = `${name}-provider-secret`;
  const scopedProviderSecret = `${name}-scoped-provider-secret`;
  const mcpSecret = `${name}-mcp-secret`;
  try {
    await raw.put('settings', 'provider_keys', { openai: [providerSecret] });
    assert.deepEqual(await vault.get('settings', 'provider_keys'), { openai: [providerSecret] });
    const migrated = await raw.get<Record<string, unknown>>('settings', 'provider_keys');
    assert.equal(migrated?.$vault, 1);
    assert.equal(JSON.stringify(migrated).includes(providerSecret), false);

    await vault.put('settings', 'provider_keys:acme', { anthropic: [scopedProviderSecret] }, 'acme');
    const scoped = await raw.get<Record<string, unknown>>('settings', 'provider_keys:acme');
    assert.equal(scoped?.$vault, 1);
    assert.equal(JSON.stringify(scoped).includes(scopedProviderSecret), false);
    assert.deepEqual(await vault.get('settings', 'provider_keys:acme'), { anthropic: [scopedProviderSecret] });

    await vault.put('mcp_servers', 'mcp_test', { id: 'mcp_test', auth: { type: 'bearer', token: mcpSecret } });
    const encrypted = await raw.get<Record<string, string>>('mcp_servers', 'mcp_test');
    assert.equal(encrypted?.$vault, 1);
    assert.equal(JSON.stringify(encrypted).includes(mcpSecret), false);
    assert.equal((await vault.get<any>('mcp_servers', 'mcp_test'))?.auth.token, mcpSecret);

    await raw.put('mcp_servers', 'mcp_test', { ...encrypted, ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA` });
    await assert.rejects(() => vault.get('mcp_servers', 'mcp_test'), (error: unknown) => {
      assert.ok(error instanceof CredentialVaultError);
      assert.match(error.message, /authentication failed/);
      assert.equal(error.message.includes(mcpSecret), false);
      return true;
    });
  } finally {
    await vault.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

describe('credential vault', () => {
  it('migrates and authenticates encrypted JSON credentials', async () => {
    await exerciseVault('json', (dir) => new JsonFileStorage(dir));
  });

  it('migrates and authenticates encrypted SQLite credentials', async () => {
    const { SqliteStorage } = await import('../src/storage/sqlite.ts');
    await exerciseVault('sqlite', (dir) => new SqliteStorage(path.join(dir, 'vault.db')));
  });

  it('rotates locally while retaining mixed-key restart safety', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-vault-rotate-'));
    const raw = new JsonFileStorage(dir);
    const vault = new VaultStorage(raw, dir);
    try {
      await vault.put('settings', 'provider_keys', { openai: ['rotation-secret'] });
      await vault.put('settings', 'provider_keys:acme', { gemini: ['scoped-rotation-secret'] }, 'acme');
      const before = await vault.credentialVaultStatus();
      const rotated = await vault.rotateCredentialVault();
      assert.notEqual(rotated.activeKeyId, before.activeKeyId);
      assert.equal(rotated.keyCount, 2);
      assert.equal((await raw.get<any>('settings', 'provider_keys')).keyId, rotated.activeKeyId);
      assert.equal((await raw.get<any>('settings', 'provider_keys:acme')).keyId, rotated.activeKeyId);
      assert.equal(JSON.stringify(await raw.get('settings', 'provider_keys')).includes('rotation-secret'), false);
      await vault.close();
      const restartedRaw = new JsonFileStorage(dir);
      const restarted = new VaultStorage(restartedRaw, dir);
      assert.deepEqual(await restarted.get('settings', 'provider_keys'), { openai: ['rotation-secret'] });
      assert.deepEqual(await restarted.get('settings', 'provider_keys:acme'), { gemini: ['scoped-rotation-secret'] });
      assert.equal((await restarted.credentialVaultStatus()).keyCount, 2);
      await restarted.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('coordinates concurrent instances and retires only unused keys', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-vault-concurrent-'));
    const rawA = new JsonFileStorage(dir); const vaultA = new VaultStorage(rawA, dir);
    const rawB = new JsonFileStorage(dir); const vaultB = new VaultStorage(rawB, dir);
    try {
      await vaultA.put('settings', 'provider_keys', { openai: ['shared-secret'] });
      const results = await Promise.all([vaultA.rotateCredentialVault(), vaultB.rotateCredentialVault()]);
      assert.equal(new Set(results.map((result) => result.activeKeyId)).size, 1);
      assert.equal((await vaultB.get<any>('settings', 'provider_keys')).openai[0], 'shared-secret');
      const retired = await vaultA.retireCredentialVaultKeys();
      assert.equal(retired.keyCount, 1);
      assert.equal(retired.retired.length, 1);
      assert.equal((await vaultB.get<any>('settings', 'provider_keys')).openai[0], 'shared-secret');
    } finally {
      await vaultA.close(); await vaultB.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  for (const driver of ['json', 'sqlite'] as const) {
    it(`resumes ${driver} rotation after every credential rewrite failure`, async () => {
      for (let failAt = 1; failAt <= 3; failAt++) {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-builder-vault-${driver}-failure-${failAt}-`));
        const makeRaw = async (): Promise<Storage> => {
          if (driver === 'json') return new JsonFileStorage(dir);
          const { SqliteStorage } = await import('../src/storage/sqlite.ts');
          return new SqliteStorage(path.join(dir, 'vault.db'));
        };
        const raw = await makeRaw();
        const injected = injectCredentialPutFailure(raw, failAt);
        const vault = new VaultStorage(injected.storage, dir);
        try {
          await vault.put('settings', 'provider_keys', { openai: [`provider-${failAt}`] });
          await vault.put('mcp_servers', 'mcp_one', { auth: { token: `mcp-one-${failAt}` } });
          await vault.put('mcp_servers', 'mcp_two', { auth: { token: `mcp-two-${failAt}` } });
          const originalKeyId = (await vault.credentialVaultStatus()).activeKeyId;
          injected.arm();

          await assert.rejects(() => vault.rotateCredentialVault(), new RegExp(`injected credential put failure ${failAt}`));
          const journalFile = path.join(dir, '.credential-vault-rotation');
          const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8')) as { targetKeyId: string; migrated: number; total: number };
          assert.notEqual(journal.targetKeyId, originalKeyId);
          assert.equal(journal.migrated, failAt - 1);
          assert.equal(journal.total, 3);
          await vault.close();

          const restartedRaw = await makeRaw();
          const restarted = new VaultStorage(restartedRaw, dir);
          try {
            assert.deepEqual(await restarted.get('settings', 'provider_keys'), { openai: [`provider-${failAt}`] });
            assert.deepEqual(await restarted.get('mcp_servers', 'mcp_one'), { auth: { token: `mcp-one-${failAt}` } });
            assert.deepEqual(await restarted.get('mcp_servers', 'mcp_two'), { auth: { token: `mcp-two-${failAt}` } });
            const status = await restarted.credentialVaultStatus();
            assert.equal(status.activeKeyId, journal.targetKeyId);
            assert.equal(status.keyCount, 2);
            assert.equal(fs.existsSync(journalFile), false);
            for (const [collection, id] of [['settings', 'provider_keys'], ['mcp_servers', 'mcp_one'], ['mcp_servers', 'mcp_two']] as const) {
              const envelope = await restartedRaw.get<{ $vault: number; keyId: string }>(collection, id);
              assert.equal(envelope?.$vault, 1);
              assert.equal(envelope?.keyId, journal.targetKeyId);
            }
          } finally {
            await restarted.close();
          }
        } finally {
          fs.rmSync(dir, { recursive: true, force: true });
        }
      }
    });
  }

  for (const phase of ['lease_acquire', 'keyring_temp_write', 'keyring_fsync', 'keyring_rename', 'journal_write', 'envelope_verification', 'journal_delete'] as VaultFailurePhase[]) {
    it(`reopens safely after ${phase} fails`, async () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), `agent-builder-vault-${phase}-`));
      const seed = new VaultStorage(new JsonFileStorage(dir), dir);
      await seed.put('settings', 'provider_keys', { openai: [`${phase}-secret`] }); await seed.close();
      let injected = false;
      const faulty = new VaultStorage(new JsonFileStorage(dir), dir, { onPhase(current) { if (!injected && current === phase) { injected = true; throw new Error(`injected ${phase}`); } } });
      await assert.rejects(() => faulty.rotateCredentialVault(), new RegExp(`injected ${phase}`)); await faulty.close();
      const raw = new JsonFileStorage(dir); const restarted = new VaultStorage(raw, dir);
      assert.deepEqual(await restarted.get('settings', 'provider_keys'), { openai: [`${phase}-secret`] });
      assert.equal(JSON.stringify(await raw.get('settings', 'provider_keys')).includes(`${phase}-secret`), false);
      await restarted.close(); fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  it('recovers a stale lease and survives cleanup failure', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-vault-stale-'));
    const seed = new VaultStorage(new JsonFileStorage(dir), dir); await seed.put('settings', 'provider_keys', { openai: ['stale-secret'] }); await seed.close();
    fs.writeFileSync(path.join(dir, '.credential-vault-rotation.lock'), JSON.stringify({ pid: 99999999, createdAt: 0 }));
    const faulty = new VaultStorage(new JsonFileStorage(dir), dir, { onPhase(phase) { if (phase === 'lease_stale_cleanup') throw new Error('injected stale cleanup'); } });
    await faulty.rotateCredentialVault(); await faulty.close();
    const restarted = new VaultStorage(new JsonFileStorage(dir), dir); assert.deepEqual(await restarted.get('settings', 'provider_keys'), { openai: ['stale-secret'] }); await restarted.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('keeps retained keys when retirement keyring persistence fails', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-builder-vault-retire-fault-'));
    const seed = new VaultStorage(new JsonFileStorage(dir), dir); await seed.put('settings', 'provider_keys', { openai: ['retire-secret'] }); await seed.rotateCredentialVault(); await seed.close();
    const faulty = new VaultStorage(new JsonFileStorage(dir), dir, { onPhase(phase) { if (phase === 'retirement_keyring_write') throw new Error('injected retirement write'); } });
    await assert.rejects(() => faulty.retireCredentialVaultKeys(), /injected retirement write/);
    assert.deepEqual(await faulty.get('settings', 'provider_keys'), { openai: ['retire-secret'] });
    assert.equal((await faulty.credentialVaultStatus()).keyCount, 2);
    await faulty.close();
    const restarted = new VaultStorage(new JsonFileStorage(dir), dir); assert.deepEqual(await restarted.get('settings', 'provider_keys'), { openai: ['retire-secret'] });
    assert.equal((await restarted.retireCredentialVaultKeys()).keyCount, 1); await restarted.close(); fs.rmSync(dir, { recursive: true, force: true });
  });
});
