/* eslint-disable */
// @ts-nocheck
// noinspection JSUnusedGlobalSymbols

import { Route as rootRouteImport } from './routes/__root'
import { Route as IndexRouteImport } from './routes/index'
import { Route as WatchlistRouteImport } from './routes/watchlist'
import { Route as VideoSlugRouteImport } from './routes/video.$slug'
import { Route as BrowseCategoriesRouteImport } from './routes/browse.categories'
import { Route as BrowsePornstarsRouteImport } from './routes/browse.pornstars'
import { Route as BrowsePornstarNameRouteImport } from './routes/browse.pornstar.$name'

const IndexRoute = IndexRouteImport.update({
  id: '/',
  path: '/',
  getParentRoute: () => rootRouteImport,
} as any)
const WatchlistRoute = WatchlistRouteImport.update({
  id: '/watchlist',
  path: '/watchlist',
  getParentRoute: () => rootRouteImport,
} as any)
const VideoSlugRoute = VideoSlugRouteImport.update({
  id: '/video/$slug',
  path: '/video/$slug',
  getParentRoute: () => rootRouteImport,
} as any)
const BrowseCategoriesRoute = BrowseCategoriesRouteImport.update({
  id: '/browse/categories',
  path: '/browse/categories',
  getParentRoute: () => rootRouteImport,
} as any)
const BrowsePornstarsRoute = BrowsePornstarsRouteImport.update({
  id: '/browse/pornstars',
  path: '/browse/pornstars',
  getParentRoute: () => rootRouteImport,
} as any)
const BrowsePornstarNameRoute = BrowsePornstarNameRouteImport.update({
  id: '/browse/pornstar/$name',
  path: '/browse/pornstar/$name',
  getParentRoute: () => rootRouteImport,
} as any)

export interface FileRoutesByFullPath {
  '/': typeof IndexRoute
  '/watchlist': typeof WatchlistRoute
  '/video/$slug': typeof VideoSlugRoute
  '/browse/categories': typeof BrowseCategoriesRoute
  '/browse/pornstars': typeof BrowsePornstarsRoute
  '/browse/pornstar/$name': typeof BrowsePornstarNameRoute
}
export interface FileRoutesByTo {
  '/': typeof IndexRoute
  '/watchlist': typeof WatchlistRoute
  '/video/$slug': typeof VideoSlugRoute
  '/browse/categories': typeof BrowseCategoriesRoute
  '/browse/pornstars': typeof BrowsePornstarsRoute
  '/browse/pornstar/$name': typeof BrowsePornstarNameRoute
}
export interface FileRoutesById {
  __root__: typeof rootRouteImport
  '/': typeof IndexRoute
  '/watchlist': typeof WatchlistRoute
  '/video/$slug': typeof VideoSlugRoute
  '/browse/categories': typeof BrowseCategoriesRoute
  '/browse/pornstars': typeof BrowsePornstarsRoute
  '/browse/pornstar/$name': typeof BrowsePornstarNameRoute
}
export interface FileRouteTypes {
  fileRoutesByFullPath: FileRoutesByFullPath
  fullPaths: '/' | '/watchlist' | '/video/$slug' | '/browse/categories' | '/browse/pornstars' | '/browse/pornstar/$name'
  fileRoutesByTo: FileRoutesByTo
  to: '/' | '/watchlist' | '/video/$slug' | '/browse/categories' | '/browse/pornstars' | '/browse/pornstar/$name'
  id: '__root__' | '/' | '/watchlist' | '/video/$slug' | '/browse/categories' | '/browse/pornstars' | '/browse/pornstar/$name'
  fileRoutesById: FileRoutesById
}
export interface RootRouteChildren {
  IndexRoute: typeof IndexRoute
  WatchlistRoute: typeof WatchlistRoute
  VideoSlugRoute: typeof VideoSlugRoute
  BrowseCategoriesRoute: typeof BrowseCategoriesRoute
  BrowsePornstarsRoute: typeof BrowsePornstarsRoute
  BrowsePornstarNameRoute: typeof BrowsePornstarNameRoute
}

declare module '@tanstack/react-router' {
  interface FileRoutesByPath {
    '/': {
      id: '/'
      path: '/'
      fullPath: '/'
      preLoaderRoute: typeof IndexRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/watchlist': {
      id: '/watchlist'
      path: '/watchlist'
      fullPath: '/watchlist'
      preLoaderRoute: typeof WatchlistRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/video/$slug': {
      id: '/video/$slug'
      path: '/video/$slug'
      fullPath: '/video/$slug'
      preLoaderRoute: typeof VideoSlugRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/browse/categories': {
      id: '/browse/categories'
      path: '/browse/categories'
      fullPath: '/browse/categories'
      preLoaderRoute: typeof BrowseCategoriesRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/browse/pornstars': {
      id: '/browse/pornstars'
      path: '/browse/pornstars'
      fullPath: '/browse/pornstars'
      preLoaderRoute: typeof BrowsePornstarsRouteImport
      parentRoute: typeof rootRouteImport
    }
    '/browse/pornstar/$name': {
      id: '/browse/pornstar/$name'
      path: '/browse/pornstar/$name'
      fullPath: '/browse/pornstar/$name'
      preLoaderRoute: typeof BrowsePornstarNameRouteImport
      parentRoute: typeof rootRouteImport
    }
  }
}

const rootRouteChildren: RootRouteChildren = {
  IndexRoute: IndexRoute,
  WatchlistRoute: WatchlistRoute,
  VideoSlugRoute: VideoSlugRoute,
  BrowseCategoriesRoute: BrowseCategoriesRoute,
  BrowsePornstarsRoute: BrowsePornstarsRoute,
  BrowsePornstarNameRoute: BrowsePornstarNameRoute,
}
export const routeTree = rootRouteImport
  ._addFileChildren(rootRouteChildren)
  ._addFileTypes<FileRouteTypes>()
