import { expect, it } from 'vitest'
import { desktopEnterpriseRelease } from '../src/enterprise-release.ts'

it('reads and freezes the sealed enterprise cloud origin', () => {
  const release = desktopEnterpriseRelease({
    dshDesktopBuildFlavor: 'enterprise',
    dshEnterpriseCloudOrigin: 'https://enterprise.example.com/',
  }, { DSH_ENTERPRISE_CLOUD_ORIGIN: 'https://ignored.example.com' }, true)
  expect(release).toEqual({ cloudOrigin: 'https://enterprise.example.com' })
  expect(Object.isFrozen(release)).toBe(true)
})

it('requires an HTTPS cloud origin for a packaged enterprise build', () => {
  expect(() => desktopEnterpriseRelease({ dshDesktopBuildFlavor: 'enterprise' }, {}, true)).toThrow('required')
  expect(() => desktopEnterpriseRelease({ dshDesktopBuildFlavor: 'enterprise',
    dshEnterpriseCloudOrigin: 'http://enterprise.example.com' }, {}, true)).toThrow('HTTPS origin')
})

it('keeps community builds out of enterprise mode', () => {
  expect(desktopEnterpriseRelease({}, { DSH_ENTERPRISE_CLOUD_ORIGIN: 'https://ignored.example.com' }, true))
    .toBeUndefined()
})

it('allows a development origin only for an unpackaged community build', () => {
  expect(desktopEnterpriseRelease({}, { DSH_ENTERPRISE_CLOUD_ORIGIN: 'http://127.0.0.1:8787' }, false))
    .toEqual({ cloudOrigin: 'http://127.0.0.1:8787' })
  expect(desktopEnterpriseRelease({ dshDesktopBuildFlavor: 'community' },
    { DSH_ENTERPRISE_CLOUD_ORIGIN: 'http://127.0.0.1:8787' }, true)).toBeUndefined()
})

it('rejects unknown build flavors', () => {
  expect(() => desktopEnterpriseRelease({ dshDesktopBuildFlavor: 'preview' }, {}, false)).toThrow('unsupported')
})
