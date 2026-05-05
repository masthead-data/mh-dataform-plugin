/**
 * Reservation configuration for the test project
 * This file defines which actions should use which BigQuery reservations
 */

const { autoAssignActions } = require('@masthead-data/dataform-package')

const RESERVATION_CONFIG = [
  {
    tag: 'production_critical',
    reservation: 'projects/my-test-project/locations/US/reservations/production',
    actions: [
      'masthead-data.test.critical_dashboard',
      'masthead-data.test.realtime_metrics',
      'masthead-data.test.test'
    ]
  },
  {
    tag: 'development',
    reservation: 'none',
    actions: [
      'masthead-data.test.experimental_table',
      'masthead-data.test.test_queries'
    ]
  },
  {
    tag: 'batch_processing',
    reservation: 'projects/my-test-project/locations/US/reservations/batch',
    actions: [
      'masthead-data.test.large_data_processing',
      'masthead-data.test.monthly_aggregation'
    ]
  },
  {
    tag: 'automated_tests',
    reservation: 'projects/my-test-project/locations/US/reservations/automated',
    actions: [
      'masthead-data.test.test_table',
      'masthead-data.test.test_view',
      'masthead-data.test.test_incremental',
      'masthead-data.test.test_operation',
      'masthead-data.test.test_single_op',
      'masthead-data.test.test_op_outer_declare',
      'masthead-data.test.test_op_inner_declare',
      'masthead-data.test.test_assertion_skipped',
      'masthead-data.test.test_table_post',
      'masthead-data.test.test_operation_post',
      'masthead-data.test.test_assertion_post_skipped'
    ]
  },
  {
    tag: 'default',
    reservation: null,
    actions: []
  }
]

autoAssignActions(RESERVATION_CONFIG)
