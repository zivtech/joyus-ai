export function assertContentDevBypassesAreSafe(): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (process.env.JOYUS_DEV_SKIP_JWT === 'true') {
    throw new Error('JOYUS_DEV_SKIP_JWT=true cannot be set in production');
  }

  if (process.env.JOYUS_DEV_ENTITLEMENT_MODE === 'all-tenant-sources') {
    throw new Error('JOYUS_DEV_ENTITLEMENT_MODE=all-tenant-sources cannot be set in production');
  }
}
