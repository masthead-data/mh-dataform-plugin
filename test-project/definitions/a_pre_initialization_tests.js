// 1. Standard Table
publish('test_table', {
  type: 'table',
  description: 'Standard table for testing reservations'
}).query('SELECT 1 as val')

// 2. View
publish('test_view', {
  type: 'view',
  description: 'View for testing reservations'
}).query('SELECT 1 as val')

// 3. Incremental with existing pre_operations
publish('test_incremental', {
  type: 'incremental',
  description: 'Incremental table with existing pre-ops'
}).preOps('DECLARE test_var INT64 DEFAULT 1;')
  .query('SELECT test_var as val')

// 4. Operation with .queries()
operate('test_operation')
  .queries([
    'CREATE OR REPLACE TEMP TABLE temp_val AS SELECT 1 as val;',
    'SELECT * FROM temp_val;'
  ])

// 5. Operation with single query string
operate('test_single_op')
  .queries('SELECT 1 as single_val')

// 6. Operation with outer DECLARE (should be skipped — BigQuery requires DECLARE first)
operate('test_op_outer_declare')
  .queries('DECLARE x INT64 DEFAULT 0;\nSET x = 1;\nSELECT x;')

// 7. Operation with DECLARE inside BEGIN (should get reservation — inner DECLARE is fine)
operate('test_op_inner_declare')
  .queries('BEGIN\n  DECLARE x INT64 DEFAULT 0;\n  SELECT x;\nEND;')

// 8. Assertion (should be skipped)
assert('test_assertion_skipped')
  .query('SELECT 1 as val WHERE false')
