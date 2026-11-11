import { BackIcon, IconButton, Screen, SectionTitle } from '../../ui'
import { href } from '../../router'

export interface FlyoverScreenProps {
  tripId: string
}

export function FlyoverScreen({ tripId }: FlyoverScreenProps) {
  return (
    <Screen>
      <IconButton label="回首頁" href={href({ name: 'home' })}>
        <BackIcon />
      </IconButton>
      <h1>立體播放 {tripId}</h1>
      <SectionTitle>尚未完成</SectionTitle>
    </Screen>
  )
}
