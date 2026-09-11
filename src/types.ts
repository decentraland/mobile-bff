import type {
  IConfigComponent,
  ILoggerComponent,
  IHttpServerComponent,
  IBaseComponent,
  IMetricsComponent,
  IFetchComponent
} from '@well-known-components/interfaces'
import { IPgComponent } from '@well-known-components/pg-component'
import { metricDeclarations } from './metrics'
import { IDbComponent } from './adapters/db'
import { ISlackComponent } from './adapters/slack'
import { ISceneGroupsDbComponent } from './adapters/scene-groups-db'
import { IBansDbComponent } from './adapters/bans-db'
import { ITagsDbComponent } from './adapters/tags-db'
import { IPlacesDbComponent } from './adapters/places-db'
import { IPlaceGroupsDbComponent } from './adapters/place-groups-db'
import { ICacheComponent } from './adapters/cache'
import { IDestinationsApiComponent } from './adapters/destinations-api'
import { IAppVersionsDbComponent } from './adapters/app-versions-db'
import { IFeatureFlagsDbComponent } from './adapters/feature-flags-db'
import { ICampaignsDbComponent } from './adapters/campaigns-db'
import { IPushDbComponent } from './adapters/push-db'
import { IFcmComponent } from './adapters/fcm'
import { IAppAttestComponent } from './adapters/app-attest'
import { IPlayIntegrityComponent } from './adapters/play-integrity'
import { IAttestationVerifierComponent } from './adapters/attestation-verifier'
import { IAttestationSessionComponent } from './adapters/attestation-session'
import { IThirdwebProxyComponent } from './adapters/thirdweb-proxy'
import { IRateLimiterComponent } from './adapters/rate-limiter'
import { IMagicComponent } from './adapters/magic'

export type GlobalContext = {
  components: BaseComponents
}

// components used in every environment
export type BaseComponents = {
  config: IConfigComponent
  logs: ILoggerComponent
  server: IHttpServerComponent<GlobalContext>
  metrics: IMetricsComponent<keyof typeof metricDeclarations>
  fetch: IFetchComponent
  pg: IPgComponent
  db: IDbComponent
  slack: ISlackComponent
  sceneGroupsDb: ISceneGroupsDbComponent
  bansDb: IBansDbComponent
  tagsDb: ITagsDbComponent
  placesDb: IPlacesDbComponent
  placeGroupsDb: IPlaceGroupsDbComponent
  cache: ICacheComponent
  destinationsApi: IDestinationsApiComponent
  appVersionsDb: IAppVersionsDbComponent
  featureFlagsDb: IFeatureFlagsDbComponent
  campaignsDb: ICampaignsDbComponent
  pushDb: IPushDbComponent
  fcm: IFcmComponent
  appAttest: IAppAttestComponent
  playIntegrity: IPlayIntegrityComponent
  attestationVerifier: IAttestationVerifierComponent
  attestationSession: IAttestationSessionComponent
  thirdwebProxy: IThirdwebProxyComponent
  rateLimiter: IRateLimiterComponent
  magic: IMagicComponent
}

// components used in runtime
export type AppComponents = BaseComponents & {
  statusChecks: IBaseComponent
}

// components used in tests
export type TestComponents = BaseComponents & {
  // A fetch component that only hits the test server
  localFetch: IFetchComponent
}

// this type simplifies the typings of http handlers
export type HandlerContextWithPath<
  ComponentNames extends keyof AppComponents,
  Path extends string = any
> = IHttpServerComponent.PathAwareContext<
  IHttpServerComponent.DefaultContext<{
    components: Pick<AppComponents, ComponentNames>
  }>,
  Path
>

export type Context<Path extends string = any> = IHttpServerComponent.PathAwareContext<GlobalContext, Path>
