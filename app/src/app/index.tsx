import { Redirect } from "expo-router";

// "/" belongs to the Worker on the web (W1, M2.1), so the app's home tab lives at
// /crowds and the app root only redirects there.
export default function Index() {
  return <Redirect href="/crowds" />;
}
