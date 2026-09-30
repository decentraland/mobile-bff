import SQL from 'sql-template-strings'
import { toSocKey } from '../../src/logic/device-support'
import { DEVICE_SUPPORT_SEED_DATA } from '../../src/migrations/data/device-support-seed-data'

type Queryable = {
  query(sql: any): Promise<any>
}

const SEED_KEYS = DEVICE_SUPPORT_SEED_DATA.map((entry) => toSocKey(entry.soc))
const SEED_MODELS = DEVICE_SUPPORT_SEED_DATA.map((entry) => entry.soc)
const SEED_DECISIONS = DEVICE_SUPPORT_SEED_DATA.map((entry) => entry.decision)

/**
 * Restores device_soc_support to exactly its migration-seeded state, keyed by soc_key rather than
 * `updated_by IS NOT NULL`: a test that mutates a seeded soc's spelling, decision or updated_by
 * (directly, or indirectly via the same shared `mobile_test` database another suite is using
 * concurrently -- see test/utils/pg.ts) leaves a row this restores rather than deletes, matching
 * how the feature-flags integration suites restore their seeds instead of guessing which rows are
 * "test fallout".
 */
export async function restoreDeviceSupportSeededState(pg: Queryable): Promise<void> {
  await pg.query(SQL`DELETE FROM device_soc_support WHERE soc_key <> ALL(${SEED_KEYS})`)
  await pg.query(SQL`
    UPDATE device_soc_support ds
       SET soc_model = v.soc_model, decision = v.decision, updated_by = NULL, updated_at = NOW()
    FROM (SELECT * FROM UNNEST(${SEED_KEYS}::text[], ${SEED_MODELS}::text[], ${SEED_DECISIONS}::text[])
          AS t(soc_key, soc_model, decision)) v
    WHERE ds.soc_key = v.soc_key
  `)
}
