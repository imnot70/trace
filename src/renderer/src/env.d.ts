/// <reference types="vite/client" />

import type { TraceApi } from '@shared/api'

declare global {
  interface Window {
    trace: TraceApi
  }
}

export {}
