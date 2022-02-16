const noop = () => undefined

const disabledLogger = {
  trace: noop,
  debug: noop,
  info: noop,
  warn: noop,
  error: noop
}

/**
 * Simple helper middleware that sets response body to the value that is returned from the provided function.
 * Additionally sets proper status code (204 if the return value is undefined, 200 otherwise)
 *
 * @param fn
 * @returns {Function}
 */
const useReturnValue = fn => async (ctx, next) => {
  const response = await fn(ctx)

  if (typeof response !== 'undefined') {
    ctx.status = 200
    ctx.body = response
  } else {
    ctx.status = 204
  }

  return next()
}

const setErrorResponse = (e, ctx, logger = disabledLogger) => {
  logger.error(e.message)
  logger.debug(e.stack)

  const message = e.error || e.body || e.message || 'Internal server error'

  ctx.status = e.statusCode || e.status || e.code || 500

  // prevent nesting of "message" prop in inter-api communication
  ctx.body = {
    message:
      typeof message === 'object' && message.message ? message.message : message
  }
}

const logError = (e, ctx, statusCode, errorCode) => {
  const logger = ctx.state.logger

  logger.error({ errorCode, statusCode }, e.message)

  if (statusCode >= 500) {
    logger.error(e.stack)
  }
}

const errorHandler = (dependencies = {}) => {
  const {
    getTraceId = ctx => ctx.state.traceId,
    instrumentation = logError
  } = dependencies

  return async (ctx, next) => {
    try {
      await next()
    } catch (e) {
      const message = e.message || 'Internal server error'
      const status = e.statusCode || 500
      const errorCode = e.code || 0
      const traceId = getTraceId(ctx)

      ctx.status = status
      ctx.body = {
        ...e.body,
        message,
        errorCode,
        traceId
      }

      await instrumentation(e, ctx, status, errorCode)
    }
  }
}

const requestProfiler = (dependencies = {}) => {
  const NS_PER_SEC = 1e9

  const {
    getLogger = ctx => ctx.state.logger,
    requestStarted = ctx => {
      getLogger(ctx).trace(`${ctx.method} ${ctx.url} starting`)
      ctx.state.timing = {
        start: process.hrtime()
      }
    },
    requestFinished = ctx => {
      const diff = process.hrtime(ctx.state.timing.start)
      const duration = Number(
        ((diff[0] * NS_PER_SEC + diff[1]) / 1000000).toFixed(2)
      )

      ctx.state.timing.duration = duration

      ctx.set('Server-Timing', `total;dur=${duration};desc="Total"`)
    },
    requestSucceeded = ctx => {
      const endpoint = `${ctx.method} ${ctx.url}`
      const elapsed = ctx.state.timing.duration
      const status = ctx.status

      getLogger(ctx).trace(
        { endpoint, status, elapsed },
        `${endpoint} finished successfully, took ${elapsed} msec.`
      )
    },
    requestFailed = ctx => {
      const endpoint = `${ctx.method} ${ctx.url}`
      const elapsed = ctx.state.timing.duration
      const status = ctx.status

      getLogger(ctx).warn(
        { endpoint, status, elapsed, error: true },
        `${endpoint} finished with ${ctx.status} error, took ${elapsed} msec.`
      )
    }
  } = dependencies

  return async (ctx, next) => {
    requestStarted(ctx)

    await next()

    requestFinished(ctx)

    if (ctx.status >= 400) {
      requestFailed(ctx)
    } else {
      requestSucceeded(ctx)
    }
  }
}

module.exports = {
  useReturnValue,
  setErrorResponse,
  logError,
  errorHandler,
  requestProfiler
}
