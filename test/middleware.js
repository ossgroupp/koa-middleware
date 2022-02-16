/* eslint-env mocha */

const sinon = require('sinon')

const middleware = require('../index')

describe('middleware', () => {
  const mockLogger = () => ({
    trace: sinon.spy(),
    debug: sinon.spy(),
    info: sinon.spy(),
    warn: sinon.spy(),
    error: sinon.spy()
  })

  describe('response helper', () => {
    it('passes ctx to the provided function', async () => {
      const ctx = {}
      const fn = sinon.spy()

      const run = middleware.useReturnValue(fn)

      await run(ctx, sinon.spy())

      sinon.assert.calledWith(fn, ctx)
    })

    it('sets status 204 for undefined return values', async () => {
      const ctx = {}
      const fn = sinon.stub().resolves(undefined)
      const runMiddleware = middleware.useReturnValue(fn)

      await runMiddleware(ctx, sinon.spy())

      expect(ctx.status).to.equal(204)
    })

    it('sets status code and response body', async () => {
      const ctx = {}
      const fn = sinon.stub().resolves('text response')
      const runMiddleware = middleware.useReturnValue(fn)

      await runMiddleware(ctx, sinon.spy())

      expect(ctx.status).to.equal(200)
      expect(ctx.body).to.equal('text response')
    })
  })

  describe('error handler', () => {
    const mockCtx = () => ({
      state: {
        logger: mockLogger(),
        traceId: 'mock-trace-id'
      }
    })

    it('returns an error response object', async () => {
      const e = new Error('An error message')
      e.statusCode = 123
      e.code = 456

      const ctx = mockCtx()
      const next = sinon.fake.rejects(e)

      const handle = middleware.errorHandler()

      await handle(ctx, next)

      expect(ctx.status).to.equal(123)
      expect(ctx.body).to.deep.equal({
        message: 'An error message',
        errorCode: 456,
        traceId: 'mock-trace-id'
      })
    })

    it('includes error body in response', async () => {
      const e = new Error('A plain error message')
      e.body = {
        prop: 'additional prop'
      }
      e.statusCode = 123
      e.code = 456

      const ctx = mockCtx()
      const next = sinon.fake.rejects(e)

      const handle = middleware.errorHandler()

      await handle(ctx, next)

      expect(ctx.status).to.equal(123)
      expect(ctx.body).to.deep.equal({
        message: 'A plain error message',
        prop: 'additional prop',
        errorCode: 456,
        traceId: 'mock-trace-id'
      })
    })

    it('calls instrumentation function', async () => {
      const ctx = mockCtx()
      const e = new Error('Generic error')
      e.statusCode = 123
      e.code = 456

      const instrumentation = sinon.spy()
      const handle = middleware.errorHandler({ instrumentation })

      await handle(ctx, sinon.fake.rejects(e))

      sinon.assert.calledOnce(instrumentation)
      sinon.assert.calledWith(instrumentation, e, ctx, 123, 456)
    })

    it('uses the trace id returned from getTraceId', async () => {
      const ctx = mockCtx()
      const e = new Error('An error message')
      const getTraceId = sinon.fake.returns('returned-trace-id')

      const handle = middleware.errorHandler({ getTraceId })

      await handle(ctx, sinon.fake.rejects(e))

      sinon.assert.calledOnce(getTraceId)
      sinon.assert.calledWith(getTraceId, ctx)

      expect(ctx.body.traceId).to.equal('returned-trace-id')
    })

    describe('default instrumentation', () => {
      it('logs error data and message', () => {
        const ctx = mockCtx()
        const e = new Error('An error message')

        middleware.logError(e, ctx, 123, 456)

        sinon.assert.calledOnce(ctx.state.logger.error)
        sinon.assert.calledWith(
          ctx.state.logger.error,
          { statusCode: 123, errorCode: 456 },
          'An error message'
        )
      })

      it('logs stack trace for server errors', () => {
        const ctx = mockCtx()
        const e = new Error('An error message')
        e.stack = 'error stack trace string'

        middleware.logError(e, ctx, 501, 456)

        sinon.assert.calledTwice(ctx.state.logger.error)
        sinon.assert.calledWith(
          ctx.state.logger.error,
          'error stack trace string'
        )
      })
    })
  })

  // @todo Test default handlers
  describe('request profiler', () => {
    const mockCtx = status => ({
      status,
      set: sinon.spy(),
      state: {
        timing: {},
        logger: mockLogger()
      }
    })

    it('calls next()', async () => {
      const next = sinon.spy()
      const profile = middleware.requestProfiler()

      await profile(mockCtx(), next)

      sinon.assert.calledOnce(next)
    })

    it('passes ctx to start and finish functions', async () => {
      const ctx = mockCtx()
      const requestStarted = sinon.spy()
      const requestFinished = sinon.spy()

      const profile = middleware.requestProfiler({
        requestStarted,
        requestFinished
      })

      await profile(ctx, sinon.spy())

      sinon.assert.calledOnce(requestStarted)
      sinon.assert.calledWith(requestStarted, ctx)

      sinon.assert.calledOnce(requestFinished)
      sinon.assert.calledWith(requestFinished, ctx)
    })

    it('calls requestFailed for status codes >= 400', async () => {
      const ctx = mockCtx(400)
      const ctx2 = mockCtx(500)
      const requestSucceeded = sinon.spy()
      const requestFailed = sinon.spy()

      const profile = middleware.requestProfiler({
        requestSucceeded,
        requestFailed
      })

      await profile(ctx, sinon.spy())
      await profile(ctx2, sinon.spy())

      sinon.assert.calledTwice(requestFailed)
      sinon.assert.calledWith(requestFailed.firstCall, ctx)
      sinon.assert.calledWith(requestFailed.secondCall, ctx2)

      sinon.assert.notCalled(requestSucceeded)
    })

    it('calls requestFailed for status codes < 400', async () => {
      const ctx = mockCtx(200)
      const ctx2 = mockCtx(399)
      const requestSucceeded = sinon.spy()
      const requestFailed = sinon.spy()

      const profile = middleware.requestProfiler({
        requestSucceeded,
        requestFailed
      })

      await profile(ctx, sinon.spy())
      await profile(ctx2, sinon.spy())

      sinon.assert.calledTwice(requestSucceeded)
      sinon.assert.calledWith(requestSucceeded.firstCall, ctx)
      sinon.assert.calledWith(requestSucceeded.secondCall, ctx2)

      sinon.assert.notCalled(requestFailed)
    })
  })
})
