// One of the shared line icons (packages/shared/src/icons.ts), drawn through expo-image
// from an SVG data URI: the same paths the Worker inlines, and no SVG dependency.
import { Image } from "expo-image";
import { iconUri, type IconName } from "@pind/shared";

export function Icon({ name, size, color }: { name: IconName; size: number; color: string }) {
  return <Image source={{ uri: iconUri(name, size, color) }} style={{ width: size, height: size }} accessible={false} />;
}
