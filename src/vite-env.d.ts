/// <reference types="vite/client" />

import type { CompassAPI } from './types'

declare global {
  interface Window {
    compass: CompassAPI
  }
}

export {}
