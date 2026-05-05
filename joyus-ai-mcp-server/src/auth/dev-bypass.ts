type DevAuthEnv = {
  ENABLE_DEV_AUTH_BYPASS?: string;
  NODE_ENV?: string;
};

export function isDevAuthBypassEnabled(env: DevAuthEnv = process.env as DevAuthEnv): boolean {
  return env.ENABLE_DEV_AUTH_BYPASS === 'true' && env.NODE_ENV !== 'production';
}
