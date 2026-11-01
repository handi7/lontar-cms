import { describe, expect, it, vi } from 'vitest'
import { collection } from '../config/collection'
import { fields } from '../fields'
import { runAfterChangeHooks, runAfterReadHooks, runBeforeChangeHooks } from './runner'
import type { AfterChangeHook, AfterReadHook, BeforeChangeHook } from './types'

describe('runBeforeChangeHooks', () => {
  it('returns original data if no hooks defined', async () => {
    const col = collection({
      slug: 'posts',
      fields: { title: fields.text() },
    })

    const data = { title: 'Hello World' }
    const result = await runBeforeChangeHooks({
      collection: col,
      data,
      operation: 'create',
    })

    expect(result).toBe(data)
  })

  it('passes all arguments correctly to hook function', async () => {
    const hookFn = vi.fn<BeforeChangeHook>(({ data }) => data)
    const col = collection({
      slug: 'posts',
      fields: { title: fields.text() },
      hooks: {
        beforeChange: [hookFn],
      },
    })

    const fakeReq = new Request('http://localhost/api/posts')
    const originalDoc = { id: 1, title: 'Old Title' }
    const data = { title: 'New Title' }

    await runBeforeChangeHooks({
      collection: col,
      data,
      operation: 'update',
      originalDoc,
      req: fakeReq,
    })

    expect(hookFn).toHaveBeenCalledWith({
      data,
      operation: 'update',
      originalDoc,
      req: fakeReq,
    })
  })

  it('runs multiple hooks sequentially, passing transformed data to next hook', async () => {
    const hook1: BeforeChangeHook = ({ data }) => {
      return { ...data, step1: true }
    }
    const hook2: BeforeChangeHook = async ({ data }) => {
      await Promise.resolve()
      return { ...data, step2: true }
    }

    const col = collection({
      slug: 'posts',
      fields: { title: fields.text() },
      hooks: {
        beforeChange: [hook1, hook2],
      },
    })

    const result = await runBeforeChangeHooks({
      collection: col,
      data: { title: 'Initial' },
      operation: 'create',
    })

    expect(result).toEqual({
      title: 'Initial',
      step1: true,
      step2: true,
    })
  })

  it('preserves in-place mutations if hook returns undefined/void', async () => {
    const mutateHook: BeforeChangeHook = ({ data }) => {
      data.mutated = true
    }

    const col = collection({
      slug: 'posts',
      fields: { title: fields.text() },
      hooks: {
        beforeChange: [mutateHook],
      },
    })

    const inputData = { title: 'Test' }
    const result = await runBeforeChangeHooks({
      collection: col,
      data: inputData,
      operation: 'create',
    })

    expect(result).toEqual({
      title: 'Test',
      mutated: true,
    })
  })
})

describe('runAfterChangeHooks', () => {
  it('returns doc unchanged when no hooks defined', async () => {
    const col = collection({
      slug: 'posts',
      fields: { title: fields.text() },
    })

    const doc = { id: 1, title: 'Test' }
    const result = await runAfterChangeHooks({
      collection: col,
      doc,
      operation: 'create',
    })

    expect(result).toBe(doc)
  })

  it('passes doc, previousDoc, operation, and req to hooks', async () => {
    const hookFn = vi.fn<AfterChangeHook>(({ doc }) => doc)
    const col = collection({
      slug: 'posts',
      fields: { title: fields.text() },
      hooks: {
        afterChange: [hookFn],
      },
    })

    const fakeReq = new Request('http://localhost/api/posts/1')
    const previousDoc = { id: 1, title: 'Previous' }
    const doc = { id: 1, title: 'Updated' }

    await runAfterChangeHooks({
      collection: col,
      doc,
      operation: 'update',
      previousDoc,
      req: fakeReq,
    })

    expect(hookFn).toHaveBeenCalledWith({
      doc,
      operation: 'update',
      previousDoc,
      req: fakeReq,
    })
  })

  it('allows afterChange hooks to modify the returned doc', async () => {
    const hook: AfterChangeHook = ({ doc }) => {
      return { ...doc, logged: true }
    }

    const col = collection({
      slug: 'posts',
      fields: { title: fields.text() },
      hooks: {
        afterChange: [hook],
      },
    })

    const result = await runAfterChangeHooks({
      collection: col,
      doc: { id: 1, title: 'Test' },
      operation: 'create',
    })

    expect(result).toEqual({
      id: 1,
      title: 'Test',
      logged: true,
    })
  })
})

describe('runAfterReadHooks', () => {
  it('returns doc unchanged when no hooks defined', async () => {
    const col = collection({
      slug: 'posts',
      fields: { title: fields.text() },
    })

    const doc = { id: 1, title: 'Test' }
    const result = await runAfterReadHooks({
      collection: col,
      doc,
    })

    expect(result).toBe(doc)
  })

  it('transforms document and passes req to afterRead hook', async () => {
    const hook: AfterReadHook = ({ doc }) => {
      return {
        ...doc,
        computedField: `Post: ${doc.title as string}`,
      }
    }

    const col = collection({
      slug: 'posts',
      fields: { title: fields.text() },
      hooks: {
        afterRead: [hook],
      },
    })

    const fakeReq = new Request('http://localhost/api/posts/1')
    const result = await runAfterReadHooks({
      collection: col,
      doc: { id: 1, title: 'My Post' },
      req: fakeReq,
    })

    expect(result).toEqual({
      id: 1,
      title: 'My Post',
      computedField: 'Post: My Post',
    })
  })
})
