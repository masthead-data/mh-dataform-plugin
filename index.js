/**
 * Extracts action name from Dataform context object
 * @param {Object} ctx - Dataform context object
 * @returns {string|null} The extracted action name or null if not found
 */
function getActionName(ctx) {
  if (!ctx) return null

  // Primary method: ctx.self()
  if (typeof ctx.self === 'function' && !ctx?.operation) {
    const selfName = ctx.self()
    if (selfName) return selfName.replace(/`/g, '').trim()
  }

  // Fallback: construct from proto target
  if (ctx?.operation?.proto?.target) {
    const target = ctx.operation.proto.target
    return target ? `${target.database}.${target.schema}.${target.name}` : null
  }

  return null
}

/**
 * Finds the matching reservation for an action name
 * @param {string} actionName - The action name to look up
 * @param {Map} actionToReservation - Preprocessed configuration Map (actionName -> reservation)
 * @returns {string|null} The reservation identifier or null
 */
function findReservation(actionName, actionToReservation) {
  if (!actionName || typeof actionName !== 'string') {
    return null
  }

  return actionToReservation.get(actionName) ?? null
}

/**
 * Validates and preprocesses the configuration array
 * @param {Array} config - Raw configuration array
 * @returns {Object} Preprocessed configuration containing both Map and original structure
 */
function preprocessConfig(config) {
  if (!config || !Array.isArray(config)) {
    throw new Error('Configuration must be a non-empty array')
  }

  if (config.length === 0) {
    throw new Error('Configuration array cannot be empty')
  }

  const actionToReservation = new Map()
  const configSets = config.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new Error(`Configuration item at index ${index} must be an object`)
    }

    if (!('reservation' in item)) {
      throw new Error(`Configuration item at index ${index} is missing 'reservation' property`)
    }

    if (!Array.isArray(item.actions)) {
      throw new Error(`Configuration item at index ${index} must have 'actions' as an array`)
    }

    const configItem = {
      tag: item.tag,
      reservation: item.reservation,
      actions: item.actions,
      actionSet: new Set(item.actions)
    }

    // Populate Map while preserving "first match wins" behavior
    configItem.actions.forEach(actionName => {
      if (!actionToReservation.has(actionName)) {
        actionToReservation.set(actionName, item.reservation)
      }
    })

    return configItem
  })

  return {
    actionToReservation,
    configSets
  }
}

/**
 * Creates a reservation setter function with the provided configuration.
 * @param {Array} config - Array of reservation configuration objects
 * @returns {Function} A reservation setter function
 * @example
 * const { createReservationSetter } = require('@masthead-data/dataform-package')
 *
 * const config = [
 *   {
 *     tag: 'production',
 *     reservation: 'projects/my-project/locations/US/reservations/prod',
 *     actions: ['my_dataset.important_table']
 *   }
 * ]
 *
 * const reservationSetter = createReservationSetter(config)
 *
 * // Use in Dataform:
 * // ${reservationSetter(ctx)}
 */
function createReservationSetter(config) {
  const { actionToReservation } = preprocessConfig(config)

  return function reservationSetter(ctx) {
    if (isNativeReservationSupported()) {
      return ''
    }

    const actionName = getActionName(ctx)
    const reservation = findReservation(actionName, actionToReservation)

    return reservation ? `SET @@reservation='${reservation}';` : ''
  }
}

let hasNativeReservationSupportCache = null

/**
 * Checks if the current Dataform project supports native reservations
 * @returns {boolean} True if native reservation supported
 */
function isNativeReservationSupported() {
  if (process.env.DATAFORM_MOCK_NATIVE_RESERVATION === 'true') return true
  if (process.env.DATAFORM_MOCK_NATIVE_RESERVATION === 'false') return false

  if (hasNativeReservationSupportCache !== null) {
    return hasNativeReservationSupportCache
  }

  hasNativeReservationSupportCache = false
  return false
}

/**
 * Helper to check if a query/array of queries has an outer DECLARE statement
 * @param {string|string[]|Function} sql - The SQL statement(s) to check
 * @returns {boolean} True if an outer DECLARE statement is found
 */
function hasOuterDeclare(sql) {
  if (Array.isArray(sql)) {
    // Check the first non-empty statement in the array
    for (let i = 0; i < sql.length; i++) {
      if (typeof sql[i] === 'string' && sql[i].trim() !== '') {
        return hasOuterDeclare(sql[i])
      }
    }
    return false
  }

  if (typeof sql === 'function' || typeof sql !== 'string') {
    return false
  }

  // Strip leading whitespace and SQL comments to find the first real statement
  let s = (sql || '').trimStart()
  let changed = true
  while (changed) {
    changed = false
    if (s.startsWith('--')) {
      const idx = s.indexOf('\n')
      s = idx === -1 ? '' : s.slice(idx + 1).trimStart()
      changed = true
    }
    if (s.startsWith('#')) {
      const idx = s.indexOf('\n')
      s = idx === -1 ? '' : s.slice(idx + 1).trimStart()
      changed = true
    }
    if (s.startsWith('/*')) {
      const idx = s.indexOf('*/')
      s = idx === -1 ? '' : s.slice(idx + 2).trimStart()
      changed = true
    }
  }

  return /^DECLARE\b/i.test(s)
}

/**
 * Ensures a statement is prepended to an array or string
 * @param {Array|string} target - The target to prepend to
 * @param {string} statement - The statement to prepend
 * @returns {Array|string} The modified target
 */
function prependStatement(target, statement) {
  if (Array.isArray(target)) {
    if (!target.includes(statement)) {
      return [statement, ...target]
    }
    return target
  }
  if (typeof target === 'string') {
    if (!target.includes(statement)) {
      return [statement, target]
    }
  }
  return target
}

/**
 * Helper to apply reservation to a single action
 * @param {Object} action - Dataform action object
 * @param {Map} actionToReservation - Preprocessed configuration Map
 */
function applyReservationToAction(action, actionToReservation) {
  const proto = action.proto || action

  // Skip assertions — Dataform wraps them in subqueries so SET would break them
  if (proto.type === 'assertion' || (action.constructor && action.constructor.name === 'Assertion')) {
    return
  }

  // Extract action name
  let actionName = null
  if (proto.target) {
    const db = proto.target.database || proto.target.project ||
      (global.dataform && global.dataform.projectConfig &&
        (global.dataform.projectConfig.defaultDatabase || global.dataform.projectConfig.defaultProject))
    const sc = proto.target.schema || proto.target.dataset ||
      (global.dataform && global.dataform.projectConfig &&
        (global.dataform.projectConfig.defaultSchema || global.dataform.projectConfig.defaultDataset))
    actionName = db && sc ? `${db}.${sc}.${proto.target.name}` : proto.target.name
  }

  const reservation = findReservation(actionName, actionToReservation)
  if (!reservation) return

  if (isNativeReservationSupported()) {
    if (!proto.actionDescriptor) proto.actionDescriptor = {}
    proto.actionDescriptor.reservation = reservation
    return
  }

  // Monkeypatch compile() so we inspect contextablePreOps/contextableQueries only after
  // all user builder calls (.preOps(), .queries()) have completed — allowing reliable
  // detection of outer DECLARE statements that must remain first in the SQL script.
  if (typeof action.compile !== 'function' || action._compilePatchedByReservation) return

  const statement = `SET @@reservation='${reservation}';`
  // Tables/views/incrementals: contextablePreOps is initialised as [] in the constructor.
  // Operations: contextablePreOps is not defined; contextableQueries is set by .queries().
  const isTableAction = Array.isArray(action.contextablePreOps)
  const originalCompile = action.compile

  action.compile = function () {
    if (isTableAction) {
      if (!hasOuterDeclare(action.contextablePreOps)) {
        action.contextablePreOps = prependStatement(action.contextablePreOps || [], statement)
      }
    } else {
      // Operation: contextableQueries may be string, array, or function
      if (Array.isArray(action.contextableQueries) || typeof action.contextableQueries === 'string') {
        if (!hasOuterDeclare(action.contextableQueries)) {
          action.contextableQueries = prependStatement(action.contextableQueries, statement)
        }
      } else if (typeof action.contextableQueries === 'function') {
        const orig = action.contextableQueries
        action.contextableQueries = (ctx) => {
          const result = orig(ctx)
          return hasOuterDeclare(result) ? result : prependStatement(result, statement)
        }
      }
    }
    return originalCompile.apply(this)
  }
  action._compilePatchedByReservation = true
}

/**
 * Automatically applies reservation configurations to all actions in the project
 * @param {Array} config - Array of reservation configuration objects
 */
function autoAssignActions(config) {
  const { actionToReservation } = preprocessConfig(config)

  // 1. Process existing actions (in case this is called late)
  if (global.dataform && global.dataform.actions) {
    global.dataform.actions.forEach(action => {
      applyReservationToAction(action, actionToReservation)
    })
  }

  // 2. Monkeypatch global functions to intercept future actions
  const globalMethods = ['publish', 'operate', 'assert']

  globalMethods.forEach(methodName => {
    if (typeof global[methodName] === 'function') {
      const originalMethod = global[methodName]
      global[methodName] = function (...args) {
        const actionBuilder = originalMethod.apply(this, args)

        // The action should be the last one added to the session
        if (global.dataform && global.dataform.actions && global.dataform.actions.length > 0) {
          const lastAction = global.dataform.actions[global.dataform.actions.length - 1]
          applyReservationToAction(lastAction, actionToReservation)
        }

        return actionBuilder
      }
    }
  })

  // 3. Monkeypatch session-level methods for SQLX
  if (global.dataform && typeof global.dataform.sqlxAction === 'function') {
    const originalSqlxAction = global.dataform.sqlxAction
    global.dataform.sqlxAction = function (...args) {
      const result = originalSqlxAction.apply(this, args)

      if (global.dataform && global.dataform.actions && global.dataform.actions.length > 0) {
        const lastAction = global.dataform.actions[global.dataform.actions.length - 1]
        applyReservationToAction(lastAction, actionToReservation)
      }
      return result
    }
  }
}

module.exports = {
  createReservationSetter,
  getActionName,
  autoAssignActions,
  prependStatement,
  findReservation,
  isNativeReservationSupported
}
