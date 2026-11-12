export { registerAdapterConformanceSuite } from './suite'
export {
  postsCollection,
  categoriesCollection,
  tagsCollection,
  pagesCollection,
  nestedCollection,
  conditionalPostsCollection,
  sharedBlocksCollection,
  headerGlobal,
  versionedSettingsGlobal,
  versionedPostsCollection,
  versionHistoryCollection,
  longSlugVersionedCollection,
  createTestConfig,
} from './fixtures'
export type {
  ConformanceSuiteContext,
  ConformanceSuiteOptions,
  RawQueryInput,
  RawQueryMapping,
  RawQueryParam,
  TestDatabaseHandle,
} from './types'
