import { Stack } from "expo-router";
import { colors as palette } from "@pind/shared";

// A1–A3, the store path. A stack with no tab bar: onboarding is a sequence, and a
// tab bar under it would offer three ways out of a flow that is 90 seconds long.
export default function OnboardingLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: palette.background },
        // Back is deliberate (the header is hidden, so it is the phone's own
        // gesture): going back from the photo to the date of birth is a normal
        // thing to want, and nothing here is written until Continue.
        gestureEnabled: true,
      }}
    />
  );
}
