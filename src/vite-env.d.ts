/// <reference types="vite/client" />

import type { CompassAPI } from './types'

declare global {
  interface Window {
    compass: CompassAPI
    MonacoEnvironment?: {
      getWorker: (workerId: string, label: string) => Worker
    }
  }
}

export {}
