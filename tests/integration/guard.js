/**
 * Last line of defence before an integration test touches a real customer database.
 *
 * vitest.integration.config.js forces VITE_USE_EMULATORS=true, but a config is easy to
 * change and the consequence of getting this wrong is writing undeletable documents into
 * production. So the suite also refuses to start unless the app module it actually imports
 * agrees it is pointed at the emulator.
 */
import { USING_EMULATORS } from '@/firebase/app.js'

if (!USING_EMULATORS) {
  throw new Error(
    'REFUSING TO RUN: integration tests are not pointed at the emulator.\n' +
      'They would write to the live Firebase project, and campaigns cannot be deleted.\n' +
      'Check VITE_USE_EMULATORS and vitest.integration.config.js.',
  )
}
