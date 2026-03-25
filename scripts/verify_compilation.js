const fs = require('fs')
const path = require('path')

const COMPILED_JSON_PATH = path.join(__dirname, '../test-project/compiled.json')
const EXPECTED_RESERVATION = 'projects/my-test-project/locations/US/reservations/automated'

function parseVersion(versionStr) {
  if (!versionStr) return 0
  const match = versionStr.match(/^(\d+)/)
  return match ? parseInt(match[1], 10) : 0
}

function verify() {
  if (!fs.existsSync(COMPILED_JSON_PATH)) {
    console.error('Error: compiled.json not found. Run compilation first.')
    process.exit(1)
  }

  const version = process.argv[2]
  console.log(`Running verification for Dataform version: ${version}`)

  let fileContent = fs.readFileSync(COMPILED_JSON_PATH, 'utf8')

  // Dataform v2.x outputs a log line before the JSON, skip it
  const lines = fileContent.split('\n')
  if (lines[0].startsWith('{"level":')) {
    fileContent = lines.slice(1).join('\n')
  }

  const compiled = JSON.parse(fileContent)

  const coreVersion = compiled.dataformCoreVersion || '0'
  const isNativeSupported = parseVersion(coreVersion) >= 3
  console.log(`Dataform core version: ${coreVersion} — native reservation support: ${isNativeSupported}`)

  let errors = []

  const expectedStatement = `SET @@reservation='${EXPECTED_RESERVATION}';`

  const checkTable = (name, expectedPreOps) => {
    const table = compiled.tables.find(t => t.target.name === name)
    if (!table) {
      errors.push(`Table ${name} not found`)
      return
    }

    if (isNativeSupported) {
      if (!table.actionDescriptor || table.actionDescriptor.reservation !== EXPECTED_RESERVATION) {
        errors.push(`Table ${name} missing reservation feature. Found: ${table.actionDescriptor ? table.actionDescriptor.reservation : '""'}`)
      }
    } else {
      const hasReservation = table.preOps && table.preOps.some(op => op.includes(expectedStatement))
      if (!hasReservation) {
        errors.push(`Table ${name} missing reservation in preOps.\nFound preOps:\n${table.preOps ? table.preOps.join('\n') : 'none'}`)
      }
      if (expectedPreOps && table.preOps && !table.preOps.some(op => op.includes(expectedPreOps))) {
        errors.push(`Table ${name} missing expected preOp: ${expectedPreOps}`)
      }
    }
  }

  const checkOperation = (name, expectedQuery) => {
    const op = compiled.operations.find(o => o.target.name === name)
    if (!op) {
      errors.push(`Operation ${name} not found`)
      return
    }

    if (isNativeSupported) {
      if (!op.actionDescriptor || op.actionDescriptor.reservation !== EXPECTED_RESERVATION) {
        errors.push(`Operation ${name} missing reservation feature. Found: ${op.actionDescriptor ? op.actionDescriptor.reservation : 'none'}`)
      }
    } else {
      const hasReservation = op.queries && op.queries.some(q => q.includes(expectedStatement))
      if (!hasReservation) {
        errors.push(`Operation ${name} missing reservation in queries.\nFound queries:\n${op.queries ? op.queries.join('\n') : 'none'}`)
      }
      if (expectedQuery && op.queries && !op.queries.some(q => q.includes(expectedQuery))) {
        errors.push(`Operation ${name} missing expected query: ${expectedQuery}`)
      }
    }
  }

  const checkAssertion = (name) => {
    const assertion = compiled.assertions.find(a => a.target.name === name)
    if (!assertion) {
      errors.push(`Assertion ${name} not found`)
      return
    }

    if (assertion.preOps && assertion.preOps.some(op => op.includes('SET @@reservation=')) || assertion.query.includes('SET @@reservation')) {
      errors.push(`Assertion ${name} should NOT have reservation re-assigned using SQL statement.`)
    }
  }

  // Verify that a table NOT in any config has no reservation injected
  const checkNoReservation = (name) => {
    const table = compiled.tables.find(t => t.target.name === name)
    if (!table) {
      errors.push(`Table ${name} not found`)
      return
    }

    const hasInjectedSql = table.preOps && table.preOps.some(op => op.includes('SET @@reservation='))
    if (hasInjectedSql) {
      errors.push(`Table ${name} should NOT have a reservation injected, but found one in preOps`)
    }

    if (isNativeSupported && table.actionDescriptor && table.actionDescriptor.reservation) {
      errors.push(`Table ${name} should NOT have a native reservation, but found: ${table.actionDescriptor.reservation}`)
    }
  }

  console.log('--- Verifying Dataform Package Integration ---')

  // Verify automated tests (Pre-initialization case)
  console.log('Checking Pre-initialization actions...')
  checkTable('test_table')
  checkTable('test_view')
  checkOperation('test_operation', 'CREATE OR REPLACE TEMP TABLE temp_val AS SELECT 1 as val;')
  checkOperation('test_single_op', 'SELECT 1 as single_val')
  checkAssertion('test_assertion_skipped')

  // Verify automated tests (Post-initialization case)
  console.log('Checking Post-initialization actions...')
  checkTable('test_table_post')
  checkOperation('test_operation_post', 'SELECT 2 as op_val')
  checkAssertion('test_assertion_post_skipped')

  // Verify that un-configured tables are not modified
  console.log('Checking no-reservation actions...')
  checkNoReservation('no_reservation_table')

  // Verify DECLARE-skip: a table whose preOps starts with DECLARE must NOT get the reservation
  // injected (BigQuery requires DECLARE to be the first statement in a script).
  console.log('Checking DECLARE-skip behavior...')
  checkNoReservation('test_incremental')

  if (errors.length > 0) {
    console.error('FAIL: Verification errors found:')
    errors.forEach(err => console.error(` - ${err}`))
    process.exit(1)
  } else {
    console.log(`SUCCESS: All integration tests passed for version ${version}!`)
  }
}

verify()
