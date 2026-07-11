/**
 * Guarded access to the Breez Spark TurboModule. The package calls
 * TurboModuleRegistry.getEnforcing at module init, which THROWS on binaries
 * that don't include it (runtime <= 1.4.1) — and Metro reports module-init
 * errors to the GLOBAL error handler, so a try/catch around import() never
 * fires and the app hard-crashes (GlitchTip #13/#14, SIGABRT on iOS 1.4.1).
 * Probe the registry first: .get() returns null instead of throwing.
 */
export async function importBreezNative(): Promise<any | null> {
  try {
    const { TurboModuleRegistry } = await import('react-native');
    if (!(TurboModuleRegistry as any)?.get?.('BreezSdkSparkReactNative')) return null;
    return await import('@breeztech/breez-sdk-spark-react-native');
  } catch {
    return null;
  }
}
