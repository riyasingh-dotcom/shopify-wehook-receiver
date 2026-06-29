declare global {
  interface Window {
    shopify: {
      ready: Promise<void>
      idToken: () => Promise<string>
      toast: {
        show: (
          message: string,
          options?: { duration?: number; isError?: boolean },
        ) => () => void
      }
    }
  }
}

export {}
