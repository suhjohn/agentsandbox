# TanStack Start + TypeScript Guide

## Overview

TanStack Start is a full-stack React framework powered by TanStack Router. It provides full-document SSR, streaming, server functions, bundling, and end-to-end type safety with TypeScript.

**Status:** Release Candidate (feature-complete, API stable)

## Key Features

- **Full-Stack TypeScript** - End-to-end type safety across client and server
- **File-Based Routing** - Automatic route generation with type inference
- **Server Functions** - Type-safe RPCs between client and server
- **Server Routes** - API endpoints with full TypeScript support
- **SSR & Streaming** - Server-side rendering and streaming out of the box
- **TanStack Router** - Powerful, type-safe routing foundation

## Getting Started

### Quick Start

```bash
npm create @tanstack/start@latest
```

You'll be prompted to choose libraries (Query, Router, Table).

### Manual Setup

```bash
# Create project directory
mkdir my-app && cd my-app
npm init -y

# Install dependencies
npm install @tanstack/react-start @tanstack/react-router
npm install -D @tanstack/router-plugin typescript vite
```

### TypeScript Configuration

Create `tsconfig.json` with recommended settings:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "isolatedModules": true
  },
  "include": ["src"]
}
```

## Project Structure

```
my-app/
├── src/
│   ├── routes/          # File-based routing
│   │   ├── __root.tsx   # Root layout
│   │   ├── index.tsx    # Home page
│   │   └── about.tsx    # About page
│   ├── components/      # React components
│   ├── server/          # Server-side logic
│   ├── router.tsx       # Router configuration
│   └── start.ts         # Start configuration
├── public/              # Static assets
├── package.json
└── tsconfig.json
```

## File-Based Routing

### Route Files

Routes are automatically discovered from the `src/routes/` directory:

```typescript
// src/routes/__root.tsx
import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => (
    <div>
      <nav>
        {/* Navigation */}
      </nav>
      <Outlet />
    </div>
  ),
})
```

```typescript
// src/routes/index.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  component: Home,
})

function Home() {
  return <h1>Home Page</h1>
}
```

### Route Naming Conventions

| File Path | URL Path | Description |
|-----------|----------|-------------|
| `routes/index.tsx` | `/` | Home page |
| `routes/about.tsx` | `/about` | About page |
| `routes/posts/index.tsx` | `/posts` | Posts list |
| `routes/posts/$id.tsx` | `/posts/:id` | Dynamic post route |
| `routes/posts/$id/edit.tsx` | `/posts/:id/edit` | Nested dynamic route |
| `routes/file/$.tsx` | `/file/*` | Wildcard route |

### Dynamic Routes

```typescript
// src/routes/posts/$id.tsx
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/posts/$id')({
  component: Post,
})

function Post() {
  const { id } = Route.useParams()
  return <div>Post ID: {id}</div>
}
```

## Server Functions

Server functions enable type-safe RPC calls from client to server.

### Creating Server Functions

```typescript
// src/server/posts.ts
import { createServerFn } from '@tanstack/react-start'

export const getPosts = createServerFn()
  .handler(async () => {
    const posts = await db.posts.findMany()
    return posts
  })

export const getPost = createServerFn()
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const post = await db.posts.findUnique({
      where: { id: data.id }
    })
    if (!post) {
      throw notFound()
    }
    return post
  })
```

### Using Server Functions in Routes

```typescript
// src/routes/posts/index.tsx
import { createFileRoute } from '@tanstack/react-router'
import { getPosts } from '../../server/posts'

export const Route = createFileRoute('/posts/')({
  loader: () => getPosts(),
  component: PostList,
})

function PostList() {
  const posts = Route.useLoaderData()
  return (
    <ul>
      {posts.map(post => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  )
}
```

### Using Server Functions in Components

```typescript
import { useServerFn } from '@tanstack/react-start'
import { useQuery } from '@tanstack/react-query'
import { getPosts } from '../server/posts'

function PostList() {
  const getPostsFn = useServerFn(getPosts)
  
  const { data, isLoading } = useQuery({
    queryKey: ['posts'],
    queryFn: () => getPostsFn(),
  })

  if (isLoading) return <div>Loading...</div>
  
  return (
    <ul>
      {data?.map(post => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  )
}
```

### Error Handling in Server Functions

```typescript
import { createServerFn } from '@tanstack/react-start'
import { redirect, notFound } from '@tanstack/react-router'

export const requireAuth = createServerFn()
  .handler(async () => {
    const user = await getCurrentUser()
    if (!user) {
      throw redirect({ to: '/login' })
    }
    return user
  })

export const getPost = createServerFn()
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const post = await db.findPost(data.id)
    if (!post) {
      throw notFound()
    }
    return post
  })
```

## Server Routes (API Routes)

Server routes create traditional REST API endpoints.

### Creating Server Routes

```typescript
// src/routes/api/users.ts
import { createServerFileRoute } from '@tanstack/react-start'
import { json } from '@tanstack/react-start'

export const ServerRoute = createServerFileRoute().methods({
  GET: async ({ request, params }) => {
    const users = await fetchUsers()
    return json(users)
  },
  
  POST: async ({ request }) => {
    const body = await request.json()
    const user = await createUser(body)
    return json(user, { status: 201 })
  },
})
```

### Dynamic Server Routes

```typescript
// src/routes/api/users/$id.ts
import { createServerFileRoute } from '@tanstack/react-start'
import { json } from '@tanstack/react-start'

export const ServerRoute = createServerFileRoute().methods({
  GET: async ({ params }) => {
    const user = await fetchUser(params.id)
    if (!user) {
      return json({ error: 'Not found' }, { status: 404 })
    }
    return json(user)
  },
  
  PUT: async ({ params, request }) => {
    const body = await request.json()
    const user = await updateUser(params.id, body)
    return json(user)
  },
  
  DELETE: async ({ params }) => {
    await deleteUser(params.id)
    return json({ success: true })
  },
})
```

### Special Route Naming

```typescript
// src/routes/users[.]json.ts - Creates /users.json
// src/routes/file/$.ts - Wildcard route /file/*
```

## When to Use Server Functions vs Server Routes

**Use Server Functions for:**
- Internal data fetching
- Mutations and form actions
- Type-safe client-server communication
- Integration with TanStack Query
- Most application logic

**Use Server Routes for:**
- Public APIs for external consumers
- Webhooks from third-party services
- File uploads/downloads
- Streaming responses
- Range requests
- CDN-style caching

## Router Configuration

```typescript
// src/router.tsx
import { createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  const router = createRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
  })
  
  return router
}

// Type registration for TypeScript
declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
```

## Type Safety Features

### Type-Safe Navigation

```typescript
import { Link } from '@tanstack/react-router'

// Fully typed - autocomplete and type checking
<Link to="/posts/$id" params={{ id: '123' }}>
  View Post
</Link>

// Type error if route doesn't exist
<Link to="/invalid-route"> {/* TypeScript error */}
```

### Type-Safe Params

```typescript
// Strict mode - only params from current route
function Post() {
  const { id } = Route.useParams() // Type: { id: string }
  return <div>{id}</div>
}

// Non-strict mode - union of all possible params
function Component() {
  const params = useParams({ strict: false })
  // Type: intersection of all route params
}
```

### Type-Safe Search Params

```typescript
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'

const searchSchema = z.object({
  page: z.number().default(1),
  sort: z.enum(['asc', 'desc']).default('asc'),
})

export const Route = createFileRoute('/posts/')({
  validateSearch: searchSchema,
  component: PostList,
})

function PostList() {
  const { page, sort } = Route.useSearch()
  // Fully typed: page is number, sort is 'asc' | 'desc'
}
```

## Data Loading Patterns

### Route Loaders

```typescript
export const Route = createFileRoute('/posts/$id')({
  loader: async ({ params }) => {
    const post = await getPost({ data: { id: params.id } })
    return { post }
  },
  component: Post,
})

function Post() {
  const { post } = Route.useLoaderData()
  return <div>{post.title}</div>
}
```

### Streaming with Suspense

```typescript
export const Route = createFileRoute('/posts/$id')({
  loader: async ({ params }) => {
    // Don't await - return promise
    const taskPromise = getTask({ data: { id: params.id } })
    return { task: taskPromise }
  },
  component: Post,
})

function Post() {
  const { task } = Route.useLoaderData()
  
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <Await promise={task}>
        {(resolvedTask) => <div>{resolvedTask.title}</div>}
      </Await>
    </Suspense>
  )
}
```

### Preloading

```typescript
export const Route = createFileRoute('/posts/')({
  loader: () => getPosts(),
  component: PostList,
})

function PostList() {
  const posts = Route.useLoaderData()
  
  return (
    <ul>
      {posts.map(post => (
        <Link
          key={post.id}
          to="/posts/$id"
          params={{ id: post.id }}
          preload="intent" // Preload on hover
        >
          {post.title}
        </Link>
      ))}
    </ul>
  )
}
```

## Middleware & Context

### Request Context

```typescript
// Augment context type
declare module '@tanstack/react-start' {
  interface RequestContext {
    user: User | null
    db: Database
  }
}

// src/start.ts
import { createStart } from '@tanstack/react-start'

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [
      async (ctx) => {
        const user = await getCurrentUser(ctx.request)
        ctx.user = user
      },
    ],
  }
})
```

### Using Context in Server Functions

```typescript
export const getProtectedData = createServerFn()
  .handler(async (_, ctx) => {
    if (!ctx.user) {
      throw redirect({ to: '/login' })
    }
    return await fetchUserData(ctx.user.id)
  })
```

## Integration with TanStack Query

```typescript
// src/router.tsx
import { QueryClient } from '@tanstack/react-query'
import { createRouter } from '@tanstack/react-router'

export function getRouter() {
  const queryClient = new QueryClient()
  
  const router = createRouter({
    routeTree,
    context: { queryClient },
  })
  
  return router
}

// In routes
export const Route = createFileRoute('/posts/')({
  loader: ({ context: { queryClient } }) => {
    return queryClient.ensureQueryData({
      queryKey: ['posts'],
      queryFn: () => getPosts(),
    })
  },
})
```

## Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-vite-plugin'

export default defineConfig({
  plugins: [
    TanStackRouterVite(), // Must come before React plugin
    react(),
  ],
})
```

## Development Workflow

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Generate route tree (usually automatic)
npm run tsr generate
```

## Best Practices

### Type Safety
- Always use TypeScript v5.3+
- Register your router for global type inference
- Use `createFileRoute` for all routes
- Leverage type-safe navigation with `Link`

### Server Functions
- Prefer server functions over server routes for internal logic
- Use input validators for type safety
- Handle errors with `redirect()` and `notFound()`
- Keep server functions focused and single-purpose

### Routing
- Use file-based routing for automatic code-splitting
- Organize routes by feature or domain
- Use layout routes for shared UI
- Implement proper loading states

### Performance
- Use `preload="intent"` for better UX
- Implement streaming for slow data
- Leverage route-level code splitting
- Cache with TanStack Query when appropriate

## Common Patterns

### Protected Routes

```typescript
export const Route = createFileRoute('/dashboard')({
  beforeLoad: async () => {
    const user = await requireAuth()
    return { user }
  },
  component: Dashboard,
})
```

### Form Handling

```typescript
const createPost = createServerFn()
  .inputValidator((data: { title: string; content: string }) => data)
  .handler(async ({ data }) => {
    const post = await db.posts.create({ data })
    throw redirect({ to: '/posts/$id', params: { id: post.id } })
  })

function NewPost() {
  const createPostFn = useServerFn(createPost)
  
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    await createPostFn({
      title: formData.get('title') as string,
      content: formData.get('content') as string,
    })
  }
  
  return <form onSubmit={handleSubmit}>{/* form fields */}</form>
}
```

### Error Boundaries

```typescript
export const Route = createFileRoute('/posts/$id')({
  loader: async ({ params }) => {
    const post = await getPost({ data: { id: params.id } })
    return { post }
  },
  errorComponent: ({ error }) => {
    return <div>Error loading post: {error.message}</div>
  },
  component: Post,
})
```

## Resources

- [Official Documentation](https://tanstack.com/start/latest)
- [TanStack Router Docs](https://tanstack.com/router/latest)
- [GitHub Repository](https://github.com/TanStack/router)
- [Discord Community](https://discord.com/invite/tanstack)

## Comparison to Other Frameworks

**vs Next.js:**
- Client-first developer experience
- More flexible routing system
- Better TypeScript inference
- No React Server Components (yet)

**vs Remix:**
- Similar full-stack approach
- More powerful type safety
- Built on TanStack Router
- Newer, smaller ecosystem

**Key Advantage:** TanStack Start prioritizes type safety and client-side experience while providing full-stack capabilities.
