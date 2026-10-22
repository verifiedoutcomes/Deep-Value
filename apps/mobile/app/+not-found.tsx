/**
 * Unknown paths land on the watchlist. The web build can be served from
 * any path (GitHub Pages subfolder, the Claude app's artifact viewer), so
 * an unmatched first URL must never strand the user on an error screen.
 */
import { Redirect } from 'expo-router';

export default function NotFound() {
  return <Redirect href="/" />;
}
