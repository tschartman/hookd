import { Redirect } from 'expo-router';

// Redirect the bare /(tabs) root to the Feed (Explore) tab so the app
// never lands on the old placeholder screen.
export default function Index() {
  return <Redirect href="/(tabs)/feed" />;
}
