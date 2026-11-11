import { Button, Ridge, Screen } from '../../ui'

export function WelcomeScreen() {
  return (
    <Screen bottom={<Button block>開啟註冊頁</Button>}>
      <Ridge variant="banner" />
      <h1>先去領一把地圖的鑰匙</h1>
    </Screen>
  )
}
