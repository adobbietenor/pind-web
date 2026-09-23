// /g/<slug>/pin in the app: a universal link to the quick pin lands here and goes on to
// the app’s A26 at /pin/<slug> (M3.2). On the web this path is the Worker’s own A26
// (spec §4), so this route is never reached there.
import { Redirect, useLocalSearchParams } from "expo-router";

export default function QuickPinLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={`/pin/${slug}`} />;
}
