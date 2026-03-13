import { QueryClient } from '@tanstack/react-query'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Navigate
} from '@tanstack/react-router'
import type { AuthContextValue } from './lib/auth'
import { RootLayout } from './routes/root'
import { LoginPage } from './routes/login'
import { RegisterPage } from './routes/register'
import { WorkspacePage } from './routes/workspace'
import { ChatLayout } from './routes/chat-layout'
import { ChatIndexPage } from './routes/chat-index'
import { SettingsLayout } from './routes/settings-layout'
import { SettingsGeneralPage } from './routes/settings-general'
import { SettingsKeybindingsPage } from './routes/settings-keybindings'
import { SettingsImagesPage } from './routes/settings-images'
import { SettingsImageDetailPage } from './routes/settings-image-detail'
import { LegacyImageSettingsRedirect } from './routes/legacy-image-settings'

export const queryClient = new QueryClient()

export interface RouterContext {
  readonly auth: AuthContextValue
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  component: RootLayout
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: WorkspacePage
})

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'login',
  component: LoginPage
})

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'register',
  component: RegisterPage
})

const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'chat',
  component: ChatLayout
})

const chatIndexRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '/',
  component: ChatIndexPage
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings',
  component: SettingsLayout
})

const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: '/',
  component: () => <Navigate to='/settings/general' replace />
})

const settingsGeneralRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'general',
  component: SettingsGeneralPage
})

const settingsKeybindingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'keybindings',
  component: SettingsKeybindingsPage
})

const settingsImagesRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'images',
  component: SettingsImagesPage
})

const settingsImageDetailRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'images/$imageId',
  component: SettingsImageDetailPage
})

const legacyImageSettingsRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: 'images/$imageId/settings',
  component: LegacyImageSettingsRedirect
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  loginRoute,
  registerRoute,
  chatRoute.addChildren([chatIndexRoute]),
  settingsRoute.addChildren([
    settingsIndexRoute,
    settingsGeneralRoute,
    settingsKeybindingsRoute,
    settingsImagesRoute,
    settingsImageDetailRoute,
    legacyImageSettingsRoute
  ])
])

export const router = createRouter({
  routeTree,
  context: {
    auth: null as unknown as AuthContextValue
  }
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
