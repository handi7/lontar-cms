export interface ClosableDb {
  close(): Promise<void> | void
}

export function isClosable(db: unknown): db is ClosableDb {
  return (
    typeof db === 'object' &&
    db !== null &&
    'close' in db &&
    typeof (db as ClosableDb).close === 'function'
  )
}

export async function closeDb(db: unknown): Promise<void> {
  if (isClosable(db)) {
    await db.close()
  }
}
