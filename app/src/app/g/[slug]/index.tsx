// A8 — /g/<slug> in the app: a universal link to a crowd page (the link pasted into
// Reddit or a text) lands here when the app is installed, and goes on to the app's crowd
// page at /crowd/<slug> (M3.3b). On the web this path is the Worker's W2 (spec §4), so
// this route is never reached there.
import { Redirect, useLocalSearchParams } from "expo-router";

export default function CrowdLink() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  return <Redirect href={`/crowd/${slug}`} />;
}
