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
