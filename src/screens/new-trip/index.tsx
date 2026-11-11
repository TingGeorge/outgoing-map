import { BackIcon, IconButton, Screen, SectionTitle } from '../../ui'
import { href } from '../../router'

export function NewTripScreen() {
  return (
    <Screen>
      <IconButton label="回首頁" href={href({ name: 'home' })}>
        <BackIcon />
      </IconButton>
      <h1>新的回憶</h1>
      <SectionTitle>尚未完成</SectionTitle>
    </Screen>
  )
}
