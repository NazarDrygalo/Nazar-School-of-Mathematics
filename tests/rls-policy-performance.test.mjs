import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const migrationPath = new URL('../supabase/migrations/20260820133000_rls_policy_performance.sql', import.meta.url)

test('RLS performance migration preserves policies while caching auth lookups', async () => {
  const sql = await readFile(migrationPath, 'utf8')
  assert.match(sql, /from pg_policies/i)
  assert.match(sql, /schemaname = 'public'/i)
  assert.match(sql, /replace\(policy_record\.qual, 'auth\.uid\(\)', '\(select auth\.uid\(\)\)'\)/i)
  assert.match(sql, /alter policy %I on %I\.%I/i)
  assert.doesNotMatch(sql, /drop policy/i)
  assert.doesNotMatch(sql, /create policy/i)
})
