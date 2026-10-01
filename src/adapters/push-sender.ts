// What every push transport (FCM, APNs) looks like to the dispatcher, which picks one per
// delivery by platform and never needs to know which it got.

export type PushMessage = {
  token: string
  /** Unique per delivery; the client de-duplicates on it. */
  pushId: string
  campaignKey: string
  title: string
  body: string
  deepLink: string
  imageUrl: string | null
  category: string
  ttlSeconds: number
}

// Discriminated by a string rather than a boolean `ok`: the test tsconfig does not enable
// strict mode, and without strictNullChecks a boolean-literal discriminant does not narrow,
// so every consumer would need a cast to read the failure fields.
export type SendResult =
  | { status: 'sent'; providerMsgId: string }
  | { status: 'error'; errorCode: string; retryable: boolean; tokenIsDead: boolean }

export type IPushSender = {
  send(message: PushMessage): Promise<SendResult>
}
