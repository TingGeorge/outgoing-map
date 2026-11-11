import { BackIcon, IconButton, Screen, SectionTitle } from '../../ui'
import { href } from '../../router'

export interface JournalScreenProps {
  tripId: string
}

export function JournalScreen({ tripId }: JournalScreenProps) {
  return (
    <Screen>
      <IconButton label="回首頁" href={href({ name: 'home' })}>
        <BackIcon />
      </IconButton>
      <h1>日誌 {tripId}</h1>
      <SectionTitle>尚未完成</SectionTitle>
    </Screen>
  )
}
