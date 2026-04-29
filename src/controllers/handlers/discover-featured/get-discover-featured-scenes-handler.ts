import { HandlerContextWithPath } from '../../../types'

// snake_case fields mirror the destinations API wire shape consumed by the mobile client.
export type DiscoverFeaturedScene = {
  title: string
  description: string
  imageUrl: string
  realm: string
  base_position?: string
}

const DISCOVER_FEATURED_SCENES: DiscoverFeaturedScene[] = [
  {
    title: 'Genesis Plaza',
    description: 'The central hub of Decentraland, where every journey begins.',
    imageUrl: 'https://decentraland.org/images/discover-featured/genesis-plaza.jpg',
    realm: 'main',
    base_position: '0,0'
  },
  {
    title: 'Vegas City',
    description: 'A neon-lit district full of casinos, music and nightlife.',
    imageUrl: 'https://decentraland.org/images/discover-featured/vegas-city.jpg',
    realm: 'main',
    base_position: '-104,134'
  },
  {
    title: 'Dragon City',
    description: 'An immersive Asian-themed district with games and shops.',
    imageUrl: 'https://decentraland.org/images/discover-featured/dragon-city.jpg',
    realm: 'main',
    base_position: '-12,136'
  },
  {
    title: 'Museum District',
    description: 'Galleries showcasing digital art and NFT collections.',
    imageUrl: 'https://decentraland.org/images/discover-featured/museum-district.jpg',
    realm: 'main',
    base_position: '-30,-30'
  },
  {
    title: 'Decentraland Conference Center',
    description: 'A featured world with live events and meetups.',
    imageUrl: 'https://decentraland.org/images/discover-featured/conference-center.jpg',
    realm: 'dcl-conference.dcl.eth'
  }
]

export async function getDiscoverFeaturedScenesHandler(
  _context: HandlerContextWithPath<never, '/discover-featured/scenes'>
) {
  return {
    status: 200,
    body: { ok: true, data: DISCOVER_FEATURED_SCENES }
  }
}
