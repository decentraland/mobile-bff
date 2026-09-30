import {
  validateSoc,
  validateDecision,
  validatePublicDecision,
  normalizeSoc,
  toSocKey,
  SOC_MAX_LENGTH
} from '../../../src/logic/device-support'

describe('device-support logic', () => {
  describe('validateSoc', () => {
    it('accepts a normal SoC and rejects a missing or blank one', () => {
      expect(validateSoc('MT6765')).toBeNull()
      expect(validateSoc('')).toMatch(/required/)
      expect(validateSoc('   ')).toMatch(/required/)
      expect(validateSoc(undefined)).toMatch(/required/)
      expect(validateSoc(42)).toMatch(/required/)
    })

    it('rejects a SoC longer than SOC_MAX_LENGTH once trimmed', () => {
      expect(validateSoc('A'.repeat(SOC_MAX_LENGTH))).toBeNull()
      expect(validateSoc('A'.repeat(SOC_MAX_LENGTH + 1))).toMatch(/at most 64/)
    })

    it('length-checks the trimmed value, not the raw one -- padding alone must not reject it', () => {
      // 64 meaningful characters padded with whitespace that normalizeSoc strips before storage;
      // the raw string is longer than the limit but the stored value fits exactly.
      const padded = `  ${'A'.repeat(SOC_MAX_LENGTH)}  `
      expect(padded.length).toBeGreaterThan(SOC_MAX_LENGTH)

      expect(validateSoc(padded)).toBeNull()
    })
  })

  describe('validateDecision', () => {
    it('accepts the two known decisions and rejects anything else', () => {
      expect(validateDecision('exclude')).toBeNull()
      expect(validateDecision('below-minspec')).toBeNull()
      expect(validateDecision('keep')).toMatch(/must be one of/)
      expect(validateDecision('')).toMatch(/must be one of/)
      expect(validateDecision(undefined)).toMatch(/must be one of/)
    })
  })

  describe('validatePublicDecision', () => {
    it('accepts the two stored decisions plus keep, and rejects anything else', () => {
      expect(validatePublicDecision('exclude')).toBeNull()
      expect(validatePublicDecision('below-minspec')).toBeNull()
      expect(validatePublicDecision('keep')).toBeNull()
      expect(validatePublicDecision('nope')).toMatch(/must be one of/)
      expect(validatePublicDecision(undefined)).toMatch(/must be one of/)
    })
  })

  describe('normalizeSoc', () => {
    it('trims and uppercases without touching internal spacing', () => {
      expect(normalizeSoc('  exynos 7420  ')).toBe('EXYNOS 7420')
      expect(normalizeSoc('mt6765')).toBe('MT6765')
    })
  })

  describe('toSocKey', () => {
    it('trims, uppercases and strips internal spaces', () => {
      expect(toSocKey('  exynos 7420  ')).toBe('EXYNOS7420')
      expect(toSocKey('EXYNOS7420')).toBe('EXYNOS7420')
      expect(toSocKey('mt6765')).toBe('MT6765')
    })

    it('produces the same key for spacing/casing variants of the same chip', () => {
      expect(toSocKey('Exynos 7420')).toBe(toSocKey('EXYNOS7420'))
    })
  })
})
